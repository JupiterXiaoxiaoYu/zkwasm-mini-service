{{- define "zkwasm-mini-service.findRpcService" -}}
{{- $serviceName := .Values.externalServices.zkwasmRpc.fallbackServiceName -}}
{{- $namespace := .Release.Namespace -}}

{{- /* 首先尝试直接查找包含rpc的服务 */ -}}
{{- range $service := (lookup "v1" "Service" $namespace "").items -}}
  {{- if contains "rpc" $service.metadata.name -}}
    {{- $serviceName = $service.metadata.name -}}
    {{- break -}}
  {{- end -}}
{{- end -}}

{{- /* 如果没有找到，尝试查找zkwasm-automata-release-rpc服务 */ -}}
{{- if eq $serviceName .Values.externalServices.zkwasmRpc.fallbackServiceName -}}
  {{- range $service := (lookup "v1" "Service" $namespace "").items -}}
    {{- if eq $service.metadata.name "zkwasm-automata-release-rpc" -}}
      {{- $serviceName = "zkwasm-automata-release-rpc" -}}
    {{- end -}}
  {{- end -}}
{{- end -}}

{{- $serviceName -}}
{{- end -}}

{{- define "zkwasm-mini-service.findMongoDBService" -}}
{{- $serviceName := .Values.externalServices.mongodb.fallbackServiceName -}}
{{- $namespace := .Release.Namespace -}}

{{- /* 尝试查找包含mongo的服务 */ -}}
{{- range $service := (lookup "v1" "Service" $namespace "").items -}}
  {{- if contains "mongo" $service.metadata.name -}}
    {{- $serviceName = $service.metadata.name -}}
    {{- break -}}
  {{- end -}}
{{- end -}}

{{- $serviceName -}}
{{- end -}}
