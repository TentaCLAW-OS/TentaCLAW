{{/*
=============================================================================
TentaCLAW OS — Helm Template Helpers
=============================================================================
*/}}

{{/*
Expand the name of the chart.
*/}}
{{- define "tentaclaw.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this
(by the DNS naming spec). If release name contains chart name it will be used
as a full name.
*/}}
{{- define "tentaclaw.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "tentaclaw.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to all resources.
*/}}
{{- define "tentaclaw.labels" -}}
helm.sh/chart: {{ include "tentaclaw.chart" . }}
app.kubernetes.io/part-of: tentaclaw
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
{{- with .Values.global.labels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Gateway labels.
*/}}
{{- define "tentaclaw.gateway.labels" -}}
{{ include "tentaclaw.labels" . }}
app.kubernetes.io/name: {{ include "tentaclaw.fullname" . }}-gateway
app.kubernetes.io/component: gateway
{{- end }}

{{/*
Gateway selector labels (used in matchLabels — must be immutable).
*/}}
{{- define "tentaclaw.gateway.selectorLabels" -}}
app.kubernetes.io/name: {{ include "tentaclaw.fullname" . }}-gateway
app.kubernetes.io/component: gateway
{{- end }}

{{/*
Agent labels.
*/}}
{{- define "tentaclaw.agent.labels" -}}
{{ include "tentaclaw.labels" . }}
app.kubernetes.io/name: {{ include "tentaclaw.fullname" . }}-agent
app.kubernetes.io/component: agent
{{- end }}

{{/*
Agent selector labels (used in matchLabels — must be immutable).
*/}}
{{- define "tentaclaw.agent.selectorLabels" -}}
app.kubernetes.io/name: {{ include "tentaclaw.fullname" . }}-agent
app.kubernetes.io/component: agent
{{- end }}

{{/*
Gateway service account name.
*/}}
{{- define "tentaclaw.gateway.serviceAccountName" -}}
{{- if .Values.gateway.serviceAccount.create }}
{{- default (printf "%s-gateway" (include "tentaclaw.fullname" .)) .Values.gateway.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.gateway.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Agent service account name.
*/}}
{{- define "tentaclaw.agent.serviceAccountName" -}}
{{- if .Values.agent.serviceAccount.create }}
{{- default (printf "%s-agent" (include "tentaclaw.fullname" .)) .Values.agent.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.agent.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Gateway internal service URL (used by agents to reach the gateway).
*/}}
{{- define "tentaclaw.gateway.internalUrl" -}}
http://{{ include "tentaclaw.fullname" . }}-gateway.{{ .Release.Namespace }}.svc.cluster.local:{{ .Values.gateway.port }}
{{- end }}

{{/*
Create the name of the secret to use.
*/}}
{{- define "tentaclaw.secretName" -}}
{{- printf "%s-secrets" (include "tentaclaw.fullname" .) }}
{{- end }}

{{/*
Image pull secrets.
*/}}
{{- define "tentaclaw.imagePullSecrets" -}}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
{{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}
