# QA Infinity — Helm Chart

Kubernetes/OpenShift translation of the project's `docker-compose.yml`. This
is the checked-in, maintained source of truth for K8s deployments — same
role `docker-compose.yml` plays for the docker-compose deployments. If you
change `docker-compose.yml`, `nginx/nginx.conf`, or `.env.example`, check
whether this chart needs the equivalent change too (nothing keeps them in
sync automatically — see the comment at the top of `templates/configmap-nginx.yaml`).

See the User Guide's "Kubernetes / OpenShift Production" section for the
underlying rationale (Pod Security Context, Postgres-on-NFS, Redis non-root,
WebSocket proxying, TLS/CORS) — this chart is that section, made concrete.

## First install

1. Build and push images to your registry (see `release-k8s.sh` at the repo
   root — this is the script that does this end-to-end and generates the
   exact commands below, tailored to a specific release).

2. Create a namespace and a `values-secrets.yaml` (gitignored — never commit
   real credentials):

   ```yaml
   # values-secrets.yaml
   secrets:
     postgresPassword: "..."
     jwtSecret: "..."
     anthropicApiKey: "..."   # or openrouterApiKey, depending on llm.provider
   ```

3. Install:

   ```bash
   kubectl create namespace qa-infinity
   helm install qa-infinity ./helm/qa-infinity \
     -f ./helm/qa-infinity/values.yaml \
     -f ./values-secrets.yaml \
     --set image.registry=harbor.internal.example.com/qa-infinity \
     --set image.tag=<commit-sha> \
     --namespace qa-infinity
   ```

## Routine hotfix (image update only)

```bash
helm upgrade qa-infinity ./helm/qa-infinity \
  -f ./helm/qa-infinity/values.yaml \
  -f ./values-secrets.yaml \
  --set image.registry=harbor.internal.example.com/qa-infinity \
  --set image.tag=<new-commit-sha> \
  --namespace qa-infinity
```

Rollback if needed: `helm rollback qa-infinity`.

## Why the image tag can never be `:latest` here

Unlike the docker-compose hotfix flow (`build-hotfix.sh`), which correctly
keeps `:latest` because `docker-compose up -d --force-recreate` always
reloads the local image cache regardless of tag — Kubernetes' `imagePullPolicy:
IfNotPresent` checks *"do I already have something tagged `:latest` cached on
this node?"* and skips pulling if so, even after the registry's `:latest`
now points at different bytes. Every hotfix needs a unique tag (the commit
SHA) so kubelet is forced to recognize it as a new image. `image.tag` is a
required value for exactly this reason — `helm install`/`upgrade` fails
loudly if you forget it, rather than silently reusing a stale image.

## Air-gapped clusters with an internal registry (Harbor, etc.)

This is the common case for this project's client deployments. See
`release-k8s.sh` — it builds locally (where you have internet), saves each
image to a tarball, and generates a README with the exact `docker load` +
`docker push` (into *their* internal registry, from *their* side) +
`helm upgrade` commands for that specific release. The physical handover
is the tarball (USB, file share, secure email) — same mechanism
`build-hotfix.sh`/`release.sh` already use, just paired with registry-push
instructions instead of docker-compose-restart instructions.

### Shipping the same release to multiple OpCos

Different OpCos commonly run different registries (one on Harbor, another
on Nexus, etc.) but need the exact same commit. Repeat `--registry` in one
run — the image is built **once** and re-tagged/re-saved per OpCo, not
rebuilt:

```bash
./release-k8s.sh \
  --registry opco1=harbor.opco1.local/qa-infinity \
  --registry opco2=nexus.opco2.local:8082/qa-infinity
```

Output lands as one folder per OpCo under a single timestamped release
directory, each self-contained with its own tarballs and its own
`README.md` (load/push/helm-upgrade steps tailored to that OpCo's exact
registry) — plus a top-level `RELEASE-SUMMARY.md` listing every OpCo in
that run:

```
releases/k8s-release/<stamp>-<commit>/
  RELEASE-SUMMARY.md
  opco1/  (qa-api-k8s.tar.gz, README.md, ...)
  opco2/  (qa-api-k8s.tar.gz, README.md, ...)
```

Hand each OpCo only its own subfolder — don't ship the whole release
directory to a single team. The `label=` part of `--registry label=path` is
optional; omit it and a folder name gets derived from the registry path
instead (uglier, but works).

## Registry examples — different teams, different registries

`--registry` (release-k8s.sh) and `image.registry` (this chart) are plain
string prefixes — nothing here is Harbor-specific despite the examples
elsewhere in this doc. `docker push`/`docker load` are standard Docker
Registry API v2 operations that Harbor, Nexus, ECR, ACR, and GitLab's
registry all implement the same way. Whatever full path (port included)
your team's registry needs is exactly what you pass:

| Registry | `--registry` / `image.registry` value | Login command (once, before pushing) |
|---|---|---|
| Harbor | `harbor.client.local/qa-infinity` | `docker login harbor.client.local` |
| Nexus (Docker-hosted repo) | `nexus.client.local:8082/qa-infinity` — Nexus typically routes each Docker repo through its own port | `docker login nexus.client.local:8082` |
| AWS ECR | `123456789012.dkr.ecr.ap-south-1.amazonaws.com/qa-infinity` | `aws ecr get-login-password \| docker login --username AWS --password-stdin <registry>` |
| Azure ACR | `myregistry.azurecr.io/qa-infinity` | `az acr login --name myregistry` |
| GitLab Container Registry | `registry.gitlab.com/<group>/qa-infinity` | `docker login registry.gitlab.com` |
| Plain Docker Registry v2 | `registry.client.local:5000/qa-infinity` | `docker login registry.client.local:5000` |

If the registry requires auth for **pulling** too (kubelet, not just your
own `docker push`), create a standard `docker-registry`-type Secret and
reference it via `image.pullSecrets` — same mechanism regardless of vendor:

```bash
kubectl create secret docker-registry qa-infinity-pull-secret \
  --docker-server=<registry> --docker-username=<user> --docker-password=<pass> \
  --namespace qa-infinity
```
```yaml
# values-secrets.yaml or --set
image:
  pullSecrets:
    - name: qa-infinity-pull-secret
```

## Values you'll almost always need to set per environment

| Value | Why |
|---|---|
| `image.registry`, `image.tag` | Required — see above |
| `corsOrigin`, `appUrl` | Must match the ingress host / how users actually reach the cluster |
| `ingress.host` | Your cluster's DNS name for this deployment |
| `targetApp.hostname`, `targetApp.ip` | Only if the app under test needs a `hostAliases` entry (equivalent to docker-compose's `extra_hosts`) — leave blank to omit entirely, same as `deploy.ps1 -StripExtraHosts` |
| `persistence.storageClassName` | Blank uses the cluster default; set explicitly on NFS/CephFS clusters |
| `persistence.scripts.accessMode` | Must support `ReadWriteMany` — both `qa-api` and `qa-runner` write/read the same `.robot` files concurrently |
