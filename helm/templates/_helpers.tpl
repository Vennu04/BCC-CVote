{{- define "bcc-cvote.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "bcc-cvote.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s" (include "bcc-cvote.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "bcc-cvote.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
app.kubernetes.io/name: {{ include "bcc-cvote.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "bcc-cvote.backendImage" -}}
{{- if .Values.image.registry }}
{{- printf "%s/%s:%s" .Values.image.registry .Values.image.backend.repository .Values.image.backend.tag }}
{{- else }}
{{- printf "%s:%s" .Values.image.backend.repository .Values.image.backend.tag }}
{{- end }}
{{- end }}

{{- define "bcc-cvote.frontendImage" -}}
{{- if .Values.image.registry }}
{{- printf "%s/%s:%s" .Values.image.registry .Values.image.frontend.repository .Values.image.frontend.tag }}
{{- else }}
{{- printf "%s:%s" .Values.image.frontend.repository .Values.image.frontend.tag }}
{{- end }}
{{- end }}
