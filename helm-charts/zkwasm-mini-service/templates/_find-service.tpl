{{- define "zkwasm-mini-service.findRpcService" -}}
{{- $serviceName := .Values.externalServices.zkwasmRpc.fallbackServiceName -}}
{{- $namespace := .Release.Namespace -}}
{{- $rpcPort := .Values.externalServices.zkwasmRpc.port -}}
{{- if .Values.externalServices.zkwasmRpc.autoDiscover -}}
  {{- /* 查找同一命名空间中的所有服务 */ -}}
  {{- range $service := (lookup "v1" "Service" $namespace "").items -}}
    {{- /* 检查服务名称是否包含 rpc 关键字 */ -}}
    {{- if contains "rpc" $service.metadata.name -}}
      {{- $serviceName = $service.metadata.name -}}
      {{- break -}}
    {{- end -}}
    
    {{- /* 检查服务是否有 RPC 端口 */ -}}
    {{- $portFound := false -}}
    {{- range $port := $service.spec.ports -}}
      {{- if eq (toString $port.port) (toString $rpcPort) -}}
        {{- $portFound = true -}}
      {{- end -}}
    {{- end -}}
    
    {{- /* 如果服务有 RPC 端口，则认为它是 RPC 服务 */ -}}
    {{- if $portFound -}}
      {{- $serviceName = $service.metadata.name -}}
      {{- break -}}
    {{- end -}}
    
    {{- /* 检查服务标签是否包含 rpc 或 api 关键字 */ -}}
    {{- range $key, $value := $service.metadata.labels -}}
      {{- if or (contains "rpc" $key) (contains "rpc" $value) (contains "api" $key) (contains "api" $value) -}}
        {{- $serviceName = $service.metadata.name -}}
        {{- break -}}
      {{- end -}}
    {{- end -}}
  {{- end -}}
{{- end -}}
{{- $serviceName -}}
{{- end -}}

{{- define "zkwasm-mini-service.findMongoDBService" -}}
{{- $serviceName := .Values.externalServices.mongodb.fallbackServiceName -}}
{{- $namespace := .Release.Namespace -}}
{{- $mongoPort := .Values.externalServices.mongodb.port -}}
{{- if .Values.externalServices.mongodb.autoDiscover -}}
  {{- /* 查找同一命名空间中的所有服务 */ -}}
  {{- range $service := (lookup "v1" "Service" $namespace "").items -}}
    {{- /* 检查服务名称是否包含 mongodb */ -}}
    {{- if contains "mongo" $service.metadata.name -}}
      {{- $serviceName = $service.metadata.name -}}
      {{- break -}}
    {{- end -}}
    
    {{- /* 检查服务是否有 MongoDB 端口 */ -}}
    {{- $portFound := false -}}
    {{- range $port := $service.spec.ports -}}
      {{- if eq (toString $port.port) (toString $mongoPort) -}}
        {{- $portFound = true -}}
      {{- end -}}
    {{- end -}}
    
    {{- /* 如果服务有 MongoDB 端口，则认为它是 MongoDB 服务 */ -}}
    {{- if $portFound -}}
      {{- $serviceName = $service.metadata.name -}}
      {{- break -}}
    {{- end -}}
  {{- end -}}
{{- end -}}
{{- $serviceName -}}
{{- end -}}
