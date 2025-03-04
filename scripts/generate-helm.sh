#!/bin/bash

# 设置变量
CHART_NAME="zkwasm-mini-service"
CHART_PATH="./helm-charts/${CHART_NAME}"
IMAGE_ENV="CE37CF0DF6D52E3A6D4A0357123FBF39"
SETTLEMENT_CONTRACT_ADDRESS="0x0703C0B64375D8CBEF5C502CCAF7909e4dBF33C8"
RPC_PROVIDER="https://ethereum-sepolia-rpc.publicnode.com"
CHAIN_ID=11155111

# 获取远程仓库信息
REPO_URL=$(git config --get remote.origin.url)
if [[ $REPO_URL == *"github.com"* ]]; then
  # 从 GitHub URL 提取用户名/组织名
  if [[ $REPO_URL == *":"* ]]; then
    # SSH 格式: git@github.com:username/repo.git
    REPO_OWNER=$(echo $REPO_URL | sed -E 's/.*:([^\/]+)\/[^\/]+.*/\1/')
  else
    # HTTPS 格式: https://github.com/username/repo.git
    REPO_OWNER=$(echo $REPO_URL | sed -E 's/.*github\.com\/([^\/]+).*/\1/')
  fi
  
  # 确保只提取用户名部分，移除任何 URL 前缀
  REPO_OWNER=$(echo $REPO_OWNER | sed 's/https:\/\///g' | sed 's/http:\/\///g')
  
  # 确保只提取用户名部分，移除 github.com 和后面的路径
  REPO_OWNER=$(echo $REPO_OWNER | sed 's/github\.com\///g' | sed 's/\/.*//g')
  
  # 转换为小写
  REPO_OWNER=$(echo $REPO_OWNER | tr '[:upper:]' '[:lower:]')
else
  # 如果不是 GitHub 仓库，使用默认值
  REPO_OWNER="jupiterxiaoxiaoyu"
  echo "Warning: Not a GitHub repository or couldn't determine owner. Using default: $REPO_OWNER"
fi

# 打印提取的用户名，用于调试
echo "Using repository owner: $REPO_OWNER"

# 创建必要的目录
mkdir -p ${CHART_PATH}/templates

# 创建基础 chart（这会自动创建所有必要文件，包括 _helpers.tpl）
helm create ${CHART_PATH}

# 清理默认的 nginx 相关配置，但保留 _helpers.tpl
rm -f ${CHART_PATH}/templates/deployment.yaml
rm -f ${CHART_PATH}/templates/service.yaml
rm -f ${CHART_PATH}/templates/serviceaccount.yaml
rm -f ${CHART_PATH}/templates/hpa.yaml
rm -f ${CHART_PATH}/templates/ingress.yaml
rm -f ${CHART_PATH}/templates/NOTES.txt
rm -f ${CHART_PATH}/values.yaml

# 生成新的 values.yaml
cat > ${CHART_PATH}/values.yaml << EOL
# Default values for ${CHART_NAME}

image:
  repository: ghcr.io/${REPO_OWNER}/${CHART_NAME}
  pullPolicy: Always
  tag: "latest"  # 可以是 latest 或特定版本

# 环境变量配置
environment:
  image: "${IMAGE_ENV}"
  settlementContractAddress: "${SETTLEMENT_CONTRACT_ADDRESS}"
  rpcProvider: "${RPC_PROVIDER}"
  chainId: ${CHAIN_ID}

# 外部服务配置
externalServices:
  mongodb:
    host: "mongodb-service"  # 外部 MongoDB 服务名称
    port: 27017
    # 是否启用自动发现
    autoDiscover: true
    # 如果无法自动发现，使用这个服务名
    fallbackServiceName: "mongodb-service"
  redis:
    host: "redis-service"    # 外部 Redis 服务名称
    port: 6379
  merkle:
    host: "merkle-service"   # 外部 Merkle 服务名称
    port: 3030
  zkwasmRpc:
    # 用于查找 RPC 服务的配置
    port: 3000
    # 如果无法自动发现，使用这个服务名
    fallbackServiceName: "rpc-service"
    # 是否启用自动发现
    autoDiscover: true

# 服务配置
service:
  type: ClusterIP
  port: 3000

# 部署配置
depositService:
  enabled: true
  replicaCount: 1
  resources:
    limits:
      cpu: 500m
      memory: 512Mi
    requests:
      cpu: 100m
      memory: 128Mi

settlementService:
  enabled: true
  replicaCount: 1
  resources:
    limits:
      cpu: 500m
      memory: 512Mi
    requests:
      cpu: 100m
      memory: 128Mi

# 通用配置
nodeSelector: {}
tolerations: []
affinity: {}

# 密钥配置
secrets:
  create: false
  name: "app-secrets"
EOL

# 创建一个辅助模板来查找服务
cat > ${CHART_PATH}/templates/_find-service.tpl << EOL
{{- define "zkwasm-mini-service.findRpcService" -}}
{{- \$serviceName := .Values.externalServices.zkwasmRpc.fallbackServiceName -}}
{{- \$namespace := .Release.Namespace -}}
{{- \$rpcPort := .Values.externalServices.zkwasmRpc.port -}}
{{- if .Values.externalServices.zkwasmRpc.autoDiscover -}}
  {{- /* 查找同一命名空间中的所有服务 */ -}}
  {{- range \$service := (lookup "v1" "Service" \$namespace "").items -}}
    {{- /* 检查服务名称是否包含 rpc 关键字 */ -}}
    {{- if contains "rpc" \$service.metadata.name -}}
      {{- \$serviceName = \$service.metadata.name -}}
      {{- break -}}
    {{- end -}}
    
    {{- /* 检查服务是否有 RPC 端口 */ -}}
    {{- \$portFound := false -}}
    {{- range \$port := \$service.spec.ports -}}
      {{- if eq (toString \$port.port) (toString \$rpcPort) -}}
        {{- \$portFound = true -}}
      {{- end -}}
    {{- end -}}
    
    {{- /* 如果服务有 RPC 端口，则认为它是 RPC 服务 */ -}}
    {{- if \$portFound -}}
      {{- \$serviceName = \$service.metadata.name -}}
      {{- break -}}
    {{- end -}}
    
    {{- /* 检查服务标签是否包含 rpc 或 api 关键字 */ -}}
    {{- range \$key, \$value := \$service.metadata.labels -}}
      {{- if or (contains "rpc" \$key) (contains "rpc" \$value) (contains "api" \$key) (contains "api" \$value) -}}
        {{- \$serviceName = \$service.metadata.name -}}
        {{- break -}}
      {{- end -}}
    {{- end -}}
  {{- end -}}
{{- end -}}
{{- \$serviceName -}}
{{- end -}}

{{- define "zkwasm-mini-service.findMongoDBService" -}}
{{- \$serviceName := .Values.externalServices.mongodb.fallbackServiceName -}}
{{- \$namespace := .Release.Namespace -}}
{{- \$mongoPort := .Values.externalServices.mongodb.port -}}
{{- if .Values.externalServices.mongodb.autoDiscover -}}
  {{- /* 查找同一命名空间中的所有服务 */ -}}
  {{- range \$service := (lookup "v1" "Service" \$namespace "").items -}}
    {{- /* 检查服务名称是否包含 mongodb */ -}}
    {{- if contains "mongo" \$service.metadata.name -}}
      {{- \$serviceName = \$service.metadata.name -}}
      {{- break -}}
    {{- end -}}
    
    {{- /* 检查服务是否有 MongoDB 端口 */ -}}
    {{- \$portFound := false -}}
    {{- range \$port := \$service.spec.ports -}}
      {{- if eq (toString \$port.port) (toString \$mongoPort) -}}
        {{- \$portFound = true -}}
      {{- end -}}
    {{- end -}}
    
    {{- /* 如果服务有 MongoDB 端口，则认为它是 MongoDB 服务 */ -}}
    {{- if \$portFound -}}
      {{- \$serviceName = \$service.metadata.name -}}
      {{- break -}}
    {{- end -}}
  {{- end -}}
{{- end -}}
{{- \$serviceName -}}
{{- end -}}
EOL

# 生成 deposit-deployment.yaml
cat > ${CHART_PATH}/templates/deposit-deployment.yaml << EOL
{{- if .Values.depositService.enabled }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "${CHART_NAME}.fullname" . }}-deposit
  labels:
    {{- include "${CHART_NAME}.labels" . | nindent 4 }}
    app.kubernetes.io/component: deposit
spec:
  replicas: {{ .Values.depositService.replicaCount }}
  selector:
    matchLabels:
      {{- include "${CHART_NAME}.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: deposit
  template:
    metadata:
      labels:
        {{- include "${CHART_NAME}.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: deposit
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          env:
            - name: DEPLOY
              value: "deposit"
            - name: MONGO_URI
              value: "mongodb://{{ include "zkwasm-mini-service.findMongoDBService" . }}:{{ .Values.externalServices.mongodb.port }}"
            - name: ZKWASM_RPC_URL
              value: "http://{{ include "zkwasm-mini-service.findRpcService" . }}:{{ .Values.externalServices.zkwasmRpc.port }}"
            - name: SERVER_ADMIN_KEY
              valueFrom:
                secretKeyRef:
                  name: {{ .Values.secrets.name }}
                  key: SERVER_ADMIN_KEY
            - name: IMAGE
              value: "{{ .Values.environment.image }}"
            - name: SETTLEMENT_CONTRACT_ADDRESS
              value: "{{ .Values.environment.settlementContractAddress }}"
            - name: RPC_PROVIDER
              value: "{{ .Values.environment.rpcProvider }}"
            - name: CHAIN_ID
              value: "{{ .Values.environment.chainId }}"
          ports:
            - name: http
              containerPort: {{ .Values.service.port }}
              protocol: TCP
          resources:
            {{- toYaml .Values.depositService.resources | nindent 12 }}
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
{{- end }}
EOL

# 生成 settlement-deployment.yaml
cat > ${CHART_PATH}/templates/settlement-deployment.yaml << EOL
{{- if .Values.settlementService.enabled }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "${CHART_NAME}.fullname" . }}-settlement
  labels:
    {{- include "${CHART_NAME}.labels" . | nindent 4 }}
    app.kubernetes.io/component: settlement
spec:
  replicas: {{ .Values.settlementService.replicaCount }}
  selector:
    matchLabels:
      {{- include "${CHART_NAME}.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: settlement
  template:
    metadata:
      labels:
        {{- include "${CHART_NAME}.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: settlement
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          env:
            - name: DEPLOY
              value: "settlement"
            - name: AUTO_SUBMIT
              value: "true"
            - name: MONGO_URI
              value: "mongodb://{{ include "zkwasm-mini-service.findMongoDBService" . }}:{{ .Values.externalServices.mongodb.port }}"
            - name: ZKWASM_RPC_URL
              value: "http://{{ include "zkwasm-mini-service.findRpcService" . }}:{{ .Values.externalServices.zkwasmRpc.port }}"
            - name: SERVER_ADMIN_KEY
              valueFrom:
                secretKeyRef:
                  name: {{ .Values.secrets.name }}
                  key: SERVER_ADMIN_KEY
            - name: SETTLER_PRIVATE_ACCOUNT
              valueFrom:
                secretKeyRef:
                  name: {{ .Values.secrets.name }}
                  key: SETTLER_PRIVATE_ACCOUNT
            - name: IMAGE
              value: "{{ .Values.environment.image }}"
            - name: SETTLEMENT_CONTRACT_ADDRESS
              value: "{{ .Values.environment.settlementContractAddress }}"
            - name: RPC_PROVIDER
              value: "{{ .Values.environment.rpcProvider }}"
            - name: CHAIN_ID
              value: "{{ .Values.environment.chainId }}"
          ports:
            - name: http
              containerPort: {{ .Values.service.port }}
              protocol: TCP
          resources:
            {{- toYaml .Values.settlementService.resources | nindent 12 }}
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
{{- end }}
EOL

# 生成 deposit-service.yaml
cat > ${CHART_PATH}/templates/deposit-service.yaml << EOL
{{- if .Values.depositService.enabled }}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "${CHART_NAME}.fullname" . }}-deposit
  labels:
    {{- include "${CHART_NAME}.labels" . | nindent 4 }}
    app.kubernetes.io/component: deposit
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: http
      protocol: TCP
      name: http
  selector:
    {{- include "${CHART_NAME}.selectorLabels" . | nindent 4 }}
    app.kubernetes.io/component: deposit
{{- end }}
EOL

# 生成 settlement-service.yaml
cat > ${CHART_PATH}/templates/settlement-service.yaml << EOL
{{- if .Values.settlementService.enabled }}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "${CHART_NAME}.fullname" . }}-settlement
  labels:
    {{- include "${CHART_NAME}.labels" . | nindent 4 }}
    app.kubernetes.io/component: settlement
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: http
      protocol: TCP
      name: http
  selector:
    {{- include "${CHART_NAME}.selectorLabels" . | nindent 4 }}
    app.kubernetes.io/component: settlement
{{- end }}
EOL

# 生成 secrets.yaml (可选)
cat > ${CHART_PATH}/templates/secrets.yaml << EOL
{{- if .Values.secrets.create }}
apiVersion: v1
kind: Secret
metadata:
  name: {{ .Values.secrets.name }}
  labels:
    {{- include "${CHART_NAME}.labels" . | nindent 4 }}
type: Opaque
data:
  SERVER_ADMIN_KEY: {{ .Values.secrets.serverAdminKey | b64enc | quote }}
  SETTLER_PRIVATE_ACCOUNT: {{ .Values.secrets.settlerPrivateKey | b64enc | quote }}
{{- end }}
EOL

# 生成 NOTES.txt
cat > ${CHART_PATH}/templates/NOTES.txt << EOL
zkWasm Mini Service has been deployed successfully.

{{- if .Values.depositService.enabled }}
Deposit Service is running at:
  http://{{ include "${CHART_NAME}.fullname" . }}-deposit.{{ .Release.Namespace }}.svc.cluster.local:{{ .Values.service.port }}

To check the status of the deposit service, run:
  kubectl get pods -l "app.kubernetes.io/name={{ include "${CHART_NAME}.name" . }},app.kubernetes.io/instance={{ .Release.Name }},app.kubernetes.io/component=deposit" -n {{ .Release.Namespace }}

To view logs from the deposit service:
  kubectl logs -f -l "app.kubernetes.io/name={{ include "${CHART_NAME}.name" . }},app.kubernetes.io/instance={{ .Release.Name }},app.kubernetes.io/component=deposit" -n {{ .Release.Namespace }}
{{- end }}

{{- if .Values.settlementService.enabled }}
Settlement Service is running at:
  http://{{ include "${CHART_NAME}.fullname" . }}-settlement.{{ .Release.Namespace }}.svc.cluster.local:{{ .Values.service.port }}

To check the status of the settlement service, run:
  kubectl get pods -l "app.kubernetes.io/name={{ include "${CHART_NAME}.name" . }},app.kubernetes.io/instance={{ .Release.Name }},app.kubernetes.io/component=settlement" -n {{ .Release.Namespace }}

To view logs from the settlement service:
  kubectl logs -f -l "app.kubernetes.io/name={{ include "${CHART_NAME}.name" . }},app.kubernetes.io/instance={{ .Release.Name }},app.kubernetes.io/component=settlement" -n {{ .Release.Namespace }}
{{- end }}
EOL

# 更新 Chart.yaml
cat > ${CHART_PATH}/Chart.yaml << EOL
apiVersion: v2
name: ${CHART_NAME}
description: A Helm chart for zkWasm Mini Service for handling L1 to L2 token deposits and settlements
type: application
version: 0.1.0
appVersion: "1.0.0"
EOL

# 生成 .helmignore
cat > ${CHART_PATH}/.helmignore << EOL
# Patterns to ignore when building packages.
*.tgz
.git
.gitignore
.idea/
*.tmproj
.vscode/
EOL

# 使脚本可执行
chmod +x scripts/generate-helm.sh

echo "Helm chart generated successfully at ${CHART_PATH}" 