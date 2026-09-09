{{/*
Common labels applied to every resource. Resource *names* are intentionally
fixed (qa-api, qa-postgres, ...) rather than release-name-prefixed, mirroring
docker-compose.yml's fixed container_name values — the app's own env vars
(RUNNER_URL, DATABASE_URL, REDIS_URL) are wired to these exact service names.
One release of this chart per namespace, same as one docker-compose stack
per host.
*/}}
{{- define "qa-infinity.labels" -}}
app.kubernetes.io/part-of: qa-infinity
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end -}}

{{- define "qa-infinity.selectorLabels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/part-of: qa-infinity
{{- end -}}
