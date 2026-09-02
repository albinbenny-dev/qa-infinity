#!/usr/bin/env python3
"""
runner-delta.py — pack/apply delta archives for qa-runner air-gapped delivery.

CONCEPT
-------
`docker save` always bundles every layer, so shipping qa-runner:latest produces
a ~2 GB tar even when only 100 MB of code changed.  This script works around
that by stripping the layers that already exist in the base image:

  PACK  (on the dev/CI machine):
        docker save qa-runner:latest  →  strip base layers  →  delta.tar.gz (~100 MB)

  APPLY (on the air-gapped machine, which already has qa-runner-base):
        delta.tar.gz  +  docker save qa-runner-base  →  reconstruct  →  docker load

USAGE
-----
  python scripts/runner-delta.py pack \
      --base  qa-runner-base:1.0.0 \
      --image qa-runner:latest \
      --out   qa-runner-delta-<sha>.tar.gz

  python scripts/runner-delta.py apply \
      --base  qa-runner-base:1.0.0 \
      --delta qa-runner-delta-<sha>.tar.gz

REQUIREMENTS
------------
  * Python 3.8+, standard library only (tarfile, gzip, json, subprocess, …)
  * docker CLI on PATH
"""

import argparse
import gzip
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SENTINEL_PREFIX = "__BASE_LAYER__"


def docker_save(image: str, path: str) -> None:
    print(f"  docker save {image} …", flush=True)
    result = subprocess.run(
        ["docker", "save", "-o", path, image],
        check=True,
    )


def get_layer_digests(image: str) -> list[str]:
    raw = subprocess.check_output(
        ["docker", "inspect", "--format", "{{json .RootFS.Layers}}", image]
    )
    return json.loads(raw)


def read_manifest(tf: tarfile.TarFile) -> dict:
    return json.loads(tf.extractfile("manifest.json").read())[0]


# ---------------------------------------------------------------------------
# PACK
# ---------------------------------------------------------------------------

def cmd_pack(base_image: str, runner_image: str, out_path: str) -> None:
    """
    Strip base-image layers from the runner image and write a small delta tar.gz.
    Stripped layers are replaced with 1-byte sentinel files so the manifest
    still lists them and apply() knows which layers to restore from the base.
    """
    base_digests = set(get_layer_digests(base_image))
    runner_digests = get_layer_digests(runner_image)

    delta_count = sum(1 for d in runner_digests if d not in base_digests)
    print(f"Base layers:   {len(base_digests)}")
    print(f"Runner layers: {len(runner_digests)}")
    print(f"Delta layers:  {delta_count}  (will be included)")
    print(f"Base layers:   {len(runner_digests) - delta_count}  (will be sentinels)")

    with tempfile.TemporaryDirectory() as tmp:
        runner_tar_path = os.path.join(tmp, "runner.tar")
        docker_save(runner_image, runner_tar_path)

        out_buf = io.BytesIO()
        with tarfile.open(runner_tar_path) as src, \
             tarfile.open(fileobj=out_buf, mode="w") as dst:

            manifest = read_manifest(src)
            layer_paths: list[str] = manifest["Layers"]

            # Build digest→path map (docker save puts digest order == layer order)
            digest_to_path: dict[str, str] = {
                d: p for d, p in zip(runner_digests, layer_paths)
            }

            included_layers: list[str] = []

            for digest, lpath in zip(runner_digests, layer_paths):
                if digest in base_digests:
                    # Replace with a tiny sentinel file that encodes the digest
                    sentinel_name = lpath.replace("layer.tar", f"{SENTINEL_PREFIX}{digest}.sentinel")
                    sentinel_bytes = digest.encode()
                    info = tarfile.TarInfo(name=sentinel_name)
                    info.size = len(sentinel_bytes)
                    dst.addfile(info, io.BytesIO(sentinel_bytes))
                    included_layers.append(sentinel_name)
                else:
                    # Include the real layer
                    member = src.getmember(lpath)
                    data = src.extractfile(member).read()
                    info = tarfile.TarInfo(name=lpath)
                    info.size = len(data)
                    dst.addfile(info, io.BytesIO(data))
                    included_layers.append(lpath)

                    # Also include the directory entry if present (legacy format)
                    dir_path = os.path.dirname(lpath) + "/"
                    try:
                        dir_member = src.getmember(dir_path)
                        dst.addfile(dir_member)
                    except KeyError:
                        pass

            # Copy image config
            config_name = manifest["Config"]
            config_data = src.extractfile(config_name).read()
            info = tarfile.TarInfo(name=config_name)
            info.size = len(config_data)
            dst.addfile(info, io.BytesIO(config_data))

            # Write updated manifest (Layers list still in order, sentinels included)
            new_manifest = [{**manifest, "Layers": included_layers}]
            manifest_bytes = json.dumps(new_manifest).encode()
            info = tarfile.TarInfo(name="manifest.json")
            info.size = len(manifest_bytes)
            dst.addfile(info, io.BytesIO(manifest_bytes))

        # Gzip-compress the delta tar
        raw = out_buf.getvalue()
        with gzip.open(out_path, "wb", compresslevel=6) as gz:
            gz.write(raw)

    size_mb = os.path.getsize(out_path) / (1024 ** 2)
    print(f"\n✓ Delta archive: {out_path}  ({size_mb:.0f} MB)")


# ---------------------------------------------------------------------------
# APPLY
# ---------------------------------------------------------------------------

def cmd_apply(base_image: str, delta_path: str) -> None:
    """
    Reconstruct the full runner image from the delta archive + local base image,
    then pipe it to `docker load`.
    """
    print("Saving base image locally to extract layers …", flush=True)
    base_digests = get_layer_digests(base_image)

    with tempfile.TemporaryDirectory() as tmp:
        base_tar_path = os.path.join(tmp, "base.tar")
        docker_save(base_image, base_tar_path)

        # Build a lookup: digest → raw layer bytes
        layer_cache: dict[str, bytes] = {}
        with tarfile.open(base_tar_path) as base_tf:
            base_manifest = read_manifest(base_tf)
            for digest, lpath in zip(base_digests, base_manifest["Layers"]):
                member = base_tf.getmember(lpath)
                layer_cache[digest] = base_tf.extractfile(member).read()

        print("Reconstructing full image …", flush=True)

        # Open delta (possibly gzip-compressed)
        opener = gzip.open if delta_path.endswith(".gz") else open
        with opener(delta_path, "rb") as gz:
            delta_bytes = gz.read()

        delta_buf = io.BytesIO(delta_bytes)
        out_buf = io.BytesIO()

        with tarfile.open(fileobj=delta_buf) as delta_tf, \
             tarfile.open(fileobj=out_buf, mode="w") as out_tf:

            manifest = read_manifest(delta_tf)
            layer_paths: list[str] = manifest["Layers"]
            real_layer_paths: list[str] = []

            for lpath in layer_paths:
                if SENTINEL_PREFIX in lpath:
                    # Restore the real layer from the base cache
                    sentinel_data = delta_tf.extractfile(lpath).read()
                    digest = sentinel_data.decode()
                    layer_data = layer_cache[digest]

                    # Recreate the original layer path
                    real_lpath = lpath[: lpath.rfind("/") + 1] + "layer.tar"
                    info = tarfile.TarInfo(name=real_lpath)
                    info.size = len(layer_data)
                    out_tf.addfile(info, io.BytesIO(layer_data))
                    real_layer_paths.append(real_lpath)
                else:
                    # Pass through the delta layer unchanged
                    member = delta_tf.getmember(lpath)
                    data = delta_tf.extractfile(member).read()
                    info = tarfile.TarInfo(name=lpath)
                    info.size = len(data)
                    out_tf.addfile(info, io.BytesIO(data))
                    real_layer_paths.append(lpath)

            # Copy image config
            config_name = manifest["Config"]
            config_data = delta_tf.extractfile(config_name).read()
            info = tarfile.TarInfo(name=config_name)
            info.size = len(config_data)
            out_tf.addfile(info, io.BytesIO(config_data))

            # Write manifest with restored layer paths
            real_manifest = [{**manifest, "Layers": real_layer_paths}]
            manifest_bytes = json.dumps(real_manifest).encode()
            info = tarfile.TarInfo(name="manifest.json")
            info.size = len(manifest_bytes)
            out_tf.addfile(info, io.BytesIO(manifest_bytes))

        print("Loading into Docker …", flush=True)
        proc = subprocess.run(
            ["docker", "load"],
            input=out_buf.getvalue(),
            capture_output=False,
        )
        if proc.returncode != 0:
            print("ERROR: docker load failed.", file=sys.stderr)
            sys.exit(1)

    print("\n✓ Image loaded successfully.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Pack/apply delta archives for qa-runner air-gapped delivery."
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("pack", help="Create delta archive (run on dev/CI machine)")
    p.add_argument("--base",  required=True, help="Base image tag, e.g. qa-runner-base:1.0.0")
    p.add_argument("--image", required=True, help="Runner image tag, e.g. qa-runner:latest")
    p.add_argument("--out",   required=True, help="Output path, e.g. qa-runner-delta-abc1234.tar.gz")

    a = sub.add_parser("apply", help="Apply delta archive (run on air-gapped machine)")
    a.add_argument("--base",  required=True, help="Base image already loaded, e.g. qa-runner-base:1.0.0")
    a.add_argument("--delta", required=True, help="Delta archive path")

    args = parser.parse_args()

    if args.cmd == "pack":
        cmd_pack(args.base, args.image, args.out)
    elif args.cmd == "apply":
        cmd_apply(args.base, args.delta)


if __name__ == "__main__":
    main()
