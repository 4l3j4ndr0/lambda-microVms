# Code Server - Lambda MicroVM

VS Code en el navegador corriendo en una Lambda MicroVM con herramientas DevOps y floci (emulador AWS local) preinstalados.

## Herramientas incluidas

| Herramienta | Descripción |
|-------------|-------------|
| code-server | VS Code en el navegador (password: `microvm2026`) |
| floci | Emulador local de AWS — S3, DynamoDB, Lambda, SQS, SNS, etc. |
| docker | Container runtime (nested containers habilitados) |
| kubectl | CLI de Kubernetes |
| k9s | TUI para Kubernetes |
| helm | Package manager de K8s |
| aws cli v2 | CLI oficial de AWS (apunta a floci por defecto) |
| git, jq, vim, tmux | Herramientas esenciales |

## Arquitectura

```
┌─────────────────────────────────────────────┐
│  Lambda MicroVM (ARM64, cgroupv2, ALL caps)  │
│                                             │
│  code-server (:8080) ──► VS Code web        │
│  hooks server (:9000) ──► lifecycle hooks   │
│  containerd + dockerd ──► nested containers │
│  floci container (:4566) ──► AWS emulador   │
│                                             │
│  .bashrc: AWS_ENDPOINT_URL=localhost:4566   │
└─────────────────────────────────────────────┘
```

Al hacer `run-microvm`, el hook `/run` arranca automáticamente:
1. containerd (~12s)
2. dockerd con vfs storage (~15s)
3. floci via Docker (~10s)

## Variables

```bash
export AWS_PROFILE=sso-personal
export AWS_REGION=us-east-1
export ACCOUNT_ID=590183999298
export BUCKET=microvm-artifacts-${ACCOUNT_ID}-${AWS_REGION}
```

## Despliegue desde cero

### 1. Crear IAM Roles (si no existen)

```bash
# Build Role
aws iam create-role --role-name MicroVMBuildRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "lambda.amazonaws.com"},
      "Action": "sts:AssumeRole",
      "Condition": {"StringEquals": {"aws:SourceAccount": "'$ACCOUNT_ID'"}}
    }]
  }'

aws iam put-role-policy --role-name MicroVMBuildRole \
  --policy-name MicroVMBuildPolicy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {"Effect": "Allow", "Action": ["s3:GetObject"], "Resource": "arn:aws:s3:::'$BUCKET'/*"},
      {"Effect": "Allow", "Action": ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"], "Resource": "arn:aws:logs:'$AWS_REGION':'$ACCOUNT_ID':log-group:/aws/lambda-microvms/*"}
    ]
  }'

# Execution Role
aws iam create-role --role-name MicroVMExecutionRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "lambda.amazonaws.com"},
      "Action": "sts:AssumeRole",
      "Condition": {"StringEquals": {"aws:SourceAccount": "'$ACCOUNT_ID'"}}
    }]
  }'

aws iam put-role-policy --role-name MicroVMExecutionRole \
  --policy-name MicroVMExecutionPolicy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {"Effect": "Allow", "Action": ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"], "Resource": "arn:aws:logs:'$AWS_REGION':'$ACCOUNT_ID':log-group:/aws/lambda-microvms/*"}
    ]
  }'
```

### 2. Empaquetar y subir

```bash
cd code-server
zip code-server.zip Dockerfile app.py
aws s3 cp code-server.zip s3://$BUCKET/microvm-images/code-server/code-artifact.zip
```

### 3. Crear imagen MicroVM

> **Importante**: usar `--additional-os-capabilities '["ALL"]'` para habilitar Docker dentro de la MicroVM. Solo funciona con `create-microvm-image`, no con `update-microvm-image`.

```bash
aws lambda-microvms create-microvm-image \
  --name code-server \
  --description "VS Code web con floci, kubectl, k9s, AWS CLI" \
  --base-image-arn arn:aws:lambda:${AWS_REGION}:aws:microvm-image:al2023-1 \
  --build-role-arn arn:aws:iam::${ACCOUNT_ID}:role/MicroVMBuildRole \
  --code-artifact '{"uri":"s3://'$BUCKET'/microvm-images/code-server/code-artifact.zip"}' \
  --additional-os-capabilities '["ALL"]' \
  --hooks '{"port":9000,"microvmImageHooks":{"ready":"ENABLED","readyTimeoutInSeconds":120},"microvmHooks":{"run":"ENABLED","runTimeoutInSeconds":60,"resume":"ENABLED","resumeTimeoutInSeconds":60,"suspend":"ENABLED","suspendTimeoutInSeconds":5,"terminate":"ENABLED","terminateTimeoutInSeconds":5}}'
```

Esperar build (~3-5 min):

```bash
aws lambda-microvms get-microvm-image \
  --image-identifier arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:microvm-image:code-server \
  --query 'state' --output text
```

### 4. Ejecutar

```bash
aws lambda-microvms run-microvm \
  --image-identifier arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:microvm-image:code-server \
  --image-version 1.0 \
  --execution-role-arn arn:aws:iam::${ACCOUNT_ID}:role/MicroVMExecutionRole \
  --idle-policy '{"maxIdleDurationSeconds":3600,"suspendedDurationSeconds":1800,"autoResumeEnabled":true}'
```

Anotar `microvmId` y `endpoint`.

### 5. Acceder con Caddy (proxy local)

code-server requiere WebSocket. Caddy lo maneja transparentemente.

```bash
# Instalar Caddy (una sola vez)
brew install caddy

# Variables
MICROVM_ID=microvm-...
ENDPOINT=...

# Generar token (máx 60 min)
TOKEN=$(aws lambda-microvms create-microvm-auth-token \
  --microvm-identifier $MICROVM_ID \
  --expiration-in-minutes 60 \
  --allowed-ports '[{"port":8080}]' \
  --query 'authToken."X-aws-proxy-auth"' --output text)

# Usar JSON config (el token es muy largo para Caddyfile)
cat > /tmp/caddy.json <<EOF
{
  "apps": {
    "http": {
      "servers": {
        "srv0": {
          "listen": [":8080"],
          "routes": [{
            "handle": [{
              "handler": "reverse_proxy",
              "headers": {
                "request": {
                  "set": {
                    "X-Aws-Proxy-Auth": ["${TOKEN}"],
                    "X-Aws-Proxy-Port": ["8080"],
                    "Host": ["${ENDPOINT}"]
                  }
                }
              },
              "upstreams": [{"dial": "${ENDPOINT}:443"}],
              "transport": {
                "protocol": "http",
                "tls": {"server_name": "${ENDPOINT}"}
              }
            }]
          }]
        }
      }
    }
  }
}
EOF

caddy start --config /tmp/caddy.json
```

Abrir en el navegador: **http://localhost:8080**
Password: **microvm2026**

#### Renovar token

```bash
caddy stop
# Regenerar TOKEN y caddy.json como arriba
caddy start --config /tmp/caddy.json
```

### 6. Usar floci (ya configurado automáticamente)

Al abrir un terminal en VS Code, todo apunta a floci:

```bash
# S3
aws s3 mb s3://my-bucket
aws s3 ls

# DynamoDB
aws dynamodb create-table --table-name users \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
aws dynamodb list-tables

# SQS
aws sqs create-queue --queue-name my-queue
aws sqs list-queues

# Lambda
aws lambda list-functions

# Verificar estado de floci
floci status
```

## Notas técnicas

- **Docker funciona** gracias a `--additional-os-capabilities '["ALL"]'` al crear la imagen
- **containerd + dockerd** arrancan en el hook `/run` (después del snapshot restore, no durante el build)
- **Storage driver `vfs`** se usa porque overlayfs no está disponible en el entorno
- **floci** corre como contenedor Docker dentro de la MicroVM
- Los **timeouts de hooks** `/run` y `/resume` son 60s para dar tiempo a toda la cadena de inicio

## Terminar

```bash
aws lambda-microvms terminate-microvm --microvm-identifier $MICROVM_ID
caddy stop
```

## Limpieza completa

```bash
aws lambda-microvms delete-microvm-image \
  --image-identifier arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:microvm-image:code-server
aws s3 rm s3://$BUCKET/microvm-images/code-server/ --recursive
```
