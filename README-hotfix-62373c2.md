# QA Infinity — Hotfix 62373c2
**Date:** 2026-09-01  
**Severity:** High — affects RF test result accuracy for Robot Framework 7.x  
**Affected services:** `qa-api` **and** `qa-runner`

---

## What this fixes

### RF test results showing wrong STATUS when using Robot Framework 7.x

When a Robot Framework script covers multiple QA Infinity TCs by tagging
scenarios (`[Tags]  TC_1  TC_2`), QA Infinity needs to map each tag back to its
scenario's individual PASS/FAIL result.

**Root cause:** RF 7.x (schemaversion 4+) changed where `<tag>` elements appear
in `output.xml`. In RF 4–6 they appear in a `<tags>` wrapper; in RF 7 they are
bare elements placed **after** keywords, just before the test-level `<status>`.
The previous code searched only the preamble (before the first `<kw>`), found
nothing, and the entire tag-result map stayed empty.

**Symptom:** When any scenario in a shared robot file fails, **all** TCs linked
to that file are marked FAILED — even those whose own scenario passed.

**Example (RF 7.4.2, 3 scenarios):**

| Scenario | Tags | RF result | Before fix | After fix |
|----------|------|-----------|-----------|-----------|
| Scenario 1 | TC_1, TC_2 | PASS | ❌ FAILED | ✅ PASSED |
| Scenario 2 | TC_3 | FAIL | ❌ FAILED | ✅ FAILED |
| Scenario 3 | TC_4, TC_5 | PASS | ❌ FAILED | ✅ PASSED |

---

## Files in this release

| File | Size | Description |
|------|------|-------------|
| `qa-api-hotfix-62373c2.tar.gz` | 630 MB | Updated `qa-api` Docker image |
| `qa-runner-base-1.0.0.tar.gz` | 2.3 GB | Runner runtime base — **load once, never ship again** |
| `qa-runner-delta-e31bd60.tar.gz` | 15 MB | Runner code delta containing this fix |
| `packages/runner/runner-delta.py` | < 1 kB | Delta apply script (Python 3.8+, stdlib only) |
| `README-hotfix-62373c2.md` | — | This file |

> **Note:** This hotfix introduces the delta delivery workflow. From now on,
> runner updates ship as small delta files (~15 MB) rather than 2.2 GB full
> images. The base image is a one-time load; keep it in your local Docker
> daemon and Harbor registry.
>
> Both `qa-api` and `qa-runner` must be updated together. The fix lives in
> `runWorker.ts` (api — primary XML lookup) and `runner/index.js`
> (runner — secondary fallback).

---

## Applying the hotfix

### Step 1 — Transfer tarballs to the air-gapped environment

Copy all three files to any machine inside the network that has `docker`.

### Step 2 — Load the runner base image (one-time)

```bash
docker load -i qa-runner-base-1.0.0.tar.gz
# Loaded image: qa-runner-base:1.0.0
```

Push it to Harbor so your nodes can pull it:

```bash
docker tag  qa-runner-base:1.0.0 ${HARBOR_HOST}/${HARBOR_PROJECT}/qa-runner-base:1.0.0
docker push ${HARBOR_HOST}/${HARBOR_PROJECT}/qa-runner-base:1.0.0
```

### Step 3 — Apply the runner delta

```bash
python3 runner-delta.py apply \
    --base  qa-runner-base:1.0.0 \
    --delta qa-runner-delta-e31bd60.tar.gz
# Loaded image: qa-infinity-qa-runner:latest
```

### Step 4 — Load the API image

```bash
docker load -i qa-api-hotfix-62373c2.tar.gz
# Loaded image: qa-infinity-qa-api:latest
```

Verify both:

```bash
docker images | grep -E "qa-infinity|qa-runner-base"
# qa-runner-base          1.0.0     <sha>   ...
# qa-infinity-qa-api      latest    <sha>   ...
# qa-infinity-qa-runner   latest    <sha>   ...
```

### Step 5 — Tag and push to Harbor

```bash
HARBOR_HOST="harbor.your-org.com"
HARBOR_PROJECT="qa-infinity"
TAG="hotfix-62373c2"

docker tag qa-infinity-qa-api:latest     ${HARBOR_HOST}/${HARBOR_PROJECT}/qa-api:${TAG}
docker tag qa-infinity-qa-runner:latest  ${HARBOR_HOST}/${HARBOR_PROJECT}/qa-runner:${TAG}

docker push ${HARBOR_HOST}/${HARBOR_PROJECT}/qa-api:${TAG}
docker push ${HARBOR_HOST}/${HARBOR_PROJECT}/qa-runner:${TAG}
```

### Step 6 — Update the deployment

#### Option A — Rolling image update

```bash
NS="<your-namespace>"
HARBOR_HOST="harbor.your-org.com"
HARBOR_PROJECT="qa-infinity"
TAG="hotfix-62373c2"

kubectl set image deployment/qa-api \
  qa-api=${HARBOR_HOST}/${HARBOR_PROJECT}/qa-api:${TAG} -n ${NS}

kubectl set image deployment/qa-runner \
  qa-runner=${HARBOR_HOST}/${HARBOR_PROJECT}/qa-runner:${TAG} -n ${NS}

kubectl rollout status deployment/qa-api    -n ${NS}
kubectl rollout status deployment/qa-runner -n ${NS}
```

#### Option B — Helm / values.yaml

```yaml
qaApi:
  image:
    tag: hotfix-62373c2

qaRunner:
  image:
    tag: hotfix-62373c2
```

```bash
helm upgrade <release-name> ./qa-infinity -f values.yaml -n <namespace>
```

### Step 7 — Verify

1. Run any Robot Framework suite that has multiple scenarios with different `[Tags]`
2. Deliberately fail one scenario
3. Confirm only the TCs tagged to the failing scenario show FAILED; all others PASSED

---

## No-downtime notes

- No database migrations — no `prisma migrate` step needed
- Rolling update keeps at least one pod alive during rollout
- In-flight runs complete before pod terminates (graceful shutdown)

---

## Previous hotfixes included in this build

This image also includes all fixes from:
- `2b5ef91` — per-TC tag status fallback via direct output.xml parsing
- `8a53156` — composite TC name matching (TC_13_TC_14_TC_22 style)
- `6e08371` — output.xml tag lookup made primary over runner-provided tags

---

*Built from commit `62373c2` on branch `main`.*  
*Contact: albin.benny@6dtech.co.in*
