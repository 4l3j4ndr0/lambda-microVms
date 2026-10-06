# Kiro Sandbox - Lambda MicroVM

Ambiente sandbox por participante para el **Kiro Day Medellín (24 oct 2026)**.
VS Code en el navegador corriendo en una Lambda MicroVM con **Kiro CLI** y
herramientas DevOps + floci (emulador AWS local) preinstalados.

Esta imagen extiende la demo `code-server` agregando `kiro-cli`.

## Herramientas incluidas

| Herramienta | Descripción |
|-------------|-------------|
| **kiro-cli** | Kiro CLI — asistente AI en terminal (`kiro-cli chat`) |
| code-server | VS Code en el navegador (password: `microvm2026`) |
| floci | Emulador local de AWS — S3, DynamoDB, Lambda, SQS, SNS, etc. |
| docker | Container runtime (nested containers habilitados) |
| kubectl | CLI de Kubernetes |
| k9s | TUI para Kubernetes |
| helm | Package manager de K8s |
| aws cli v2 | CLI oficial de AWS (apunta a floci por defecto) |
| node 22 | Runtime JS (requerido por code-server) |
| git, jq, vim, tmux | Herramientas esenciales |

## Arquitectura

```
┌───────────────────────────────────────────────┐
│  Lambda MicroVM (ARM64, al2023, ALL caps)      │
│                                                │
│  code-server (:8080) ──► VS Code web           │
│  hooks server (:9000) ──► lifecycle hooks      │
│  kiro-cli ──────────────► AI agent en terminal │
│  containerd + dockerd ──► nested containers    │
│  floci container (:4566) ─► AWS emulador       │
│                                                │
│  .bashrc: PATH + AWS_ENDPOINT_URL=:4566        │
└───────────────────────────────────────────────┘
```

Al hacer `run-microvm`, el hook `/run` arranca automáticamente:
1. containerd (~12s)
2. dockerd con vfs storage (~15s)
3. floci via Docker (~10s)

code-server y kiro-cli ya están presentes en el snapshot (listos al boot).

## Autenticación de Kiro CLI (headless) ⚠️

Kiro CLI requiere login con AWS Builder ID. En una MicroVM efímera y sin navegador,
`kiro-cli login` usa **device-code flow**: imprime una URL + código que el participante
abre en el navegador de su laptop para autorizar. No requiere navegador dentro de la VM.

```bash
# Dentro del terminal de code-server:
kiro-cli login
# → Abre https://device.sso... e ingresa el código mostrado
kiro-cli chat          # ya autenticado
```

> **No** incrustar credenciales ni tokens de Builder ID en la imagen: el snapshot se
> comparte entre todas las MicroVMs de la misma versión. Cada participante hace su
> propio `kiro-cli login` tras arrancar su sandbox.

## Variables

```bash
export AWS_PROFILE=sso-personal
export AWS_REGION=us-east-1
export ACCOUNT_ID=<tu-account-id>
export BUCKET=microvm-artifacts-${ACCOUNT_ID}-${AWS_REGION}
```

## Despliegue desde cero

### 1. Crear IAM Roles (si no existen)

```bash
# Build Role — trust policy con aws:SourceAccount (confused deputy)
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

# Execution Role — mismo patrón de trust policy
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
cd kiro-sandbox
zip kiro-sandbox.zip Dockerfile app.py
aws s3 cp kiro-sandbox.zip s3://$BUCKET/microvm-images/kiro-sandbox/code-artifact.zip
```

### 3. Crear imagen MicroVM

> **Importante**: usar `--additional-os-capabilities '["ALL"]'` para habilitar Docker
> dentro de la MicroVM. Solo funciona con `create-microvm-image`, no con `update-microvm-image`.

```bash
aws lambda-microvms create-microvm-image \
  --name kiro-sandbox \
  --description "VS Code web + Kiro CLI, floci, kubectl, k9s, AWS CLI" \
  --base-image-arn arn:aws:lambda:${AWS_REGION}:aws:microvm-image:al2023-1 \
  --build-role-arn arn:aws:iam::${ACCOUNT_ID}:role/MicroVMBuildRole \
  --code-artifact '{"uri":"s3://'$BUCKET'/microvm-images/kiro-sandbox/code-artifact.zip"}' \
  --additional-os-capabilities '["ALL"]' \
  --hooks '{"port":9000,"microvmImageHooks":{"ready":"ENABLED","readyTimeoutInSeconds":120},"microvmHooks":{"run":"ENABLED","runTimeoutInSeconds":60,"resume":"ENABLED","resumeTimeoutInSeconds":60,"suspend":"ENABLED","suspendTimeoutInSeconds":5,"terminate":"ENABLED","terminateTimeoutInSeconds":5}}'
```

Esperar build (~5-8 min; Kiro CLI + code-server + node suman tiempo de descarga):

```bash
aws lambda-microvms get-microvm-image \
  --image-identifier arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:microvm-image:kiro-sandbox \
  --query 'state' --output text
```

### 4. Ejecutar

```bash
aws lambda-microvms run-microvm \
  --image-identifier arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:microvm-image:kiro-sandbox \
  --image-version 1.0 \
  --execution-role-arn arn:aws:iam::${ACCOUNT_ID}:role/MicroVMExecutionRole \
  --idle-policy '{"maxIdleDurationSeconds":3600,"suspendedDurationSeconds":1800,"autoResumeEnabled":true}'
```

Anotar `microvmId` y `endpoint`.

### 5. Acceder con Caddy (proxy local)

code-server requiere WebSocket. Caddy lo maneja transparentemente.

```bash
brew install caddy   # una sola vez

MICROVM_ID=microvm-...
ENDPOINT=...

# Token (TTL mínimo necesario — aquí 60 min, el máximo, por sesión de workshop)
TOKEN=$(aws lambda-microvms create-microvm-auth-token \
  --microvm-identifier $MICROVM_ID \
  --expiration-in-minutes 60 \
  --allowed-ports '[{"port":8080}]' \
  --query 'authToken."X-aws-proxy-auth"' --output text)

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

Abrir: **http://localhost:8080** — Password: **microvm2026**

### 6. Usar Kiro CLI

En un terminal de VS Code (dentro del navegador):

```bash
kiro-cli login     # device-code: abre la URL mostrada en tu laptop
kiro-cli chat      # empezar a usar el agente
```

### 7. Usar floci (ya configurado automáticamente)

```bash
aws s3 mb s3://my-bucket && aws s3 ls
aws dynamodb list-tables
aws sqs create-queue --queue-name my-queue
floci status
```

## Notas técnicas

- **Kiro CLI** se instala desde el ZIP oficial `kirocli-aarch64-linux.zip` con
  `install.sh --no-confirm` (build headless). Binario en `/root/.local/bin/kiro-cli`,
  symlink en `/usr/local/bin/kiro-cli`.
- **Docker funciona** gracias a `--additional-os-capabilities '["ALL"]'`.
- **containerd + dockerd** arrancan en `/run` (post snapshot restore).
- **Storage driver `vfs`** (overlayfs no disponible).
- **Reseed de entropía** en `/resume` — el snapshot comparte estado de memoria.
- **Timeouts de hooks** `/run` y `/resume` en 60s para la cadena de arranque.

## Terminar

```bash
aws lambda-microvms terminate-microvm --microvm-identifier $MICROVM_ID
caddy stop
```

## Limpieza completa

```bash
aws lambda-microvms delete-microvm-image \
  --image-identifier arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:microvm-image:kiro-sandbox
aws s3 rm s3://$BUCKET/microvm-images/kiro-sandbox/ --recursive
```
