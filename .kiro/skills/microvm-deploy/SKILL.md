---
name: microvm-deploy
description: Empaqueta una imagen de Lambda MicroVM (Dockerfile + app.py) y la sube versionada al bucket de artefactos S3, luego entrega al usuario la guía de comandos aws lambda-microvms para crear/actualizar la imagen y correr la MicroVM. Load cuando el usuario quiera desplegar, publicar, subir o versionar una microVM al bucket, o cuando pida "sube la versión al bucket".
triggers: desplegar microvm, deploy microvm, subir microvm, subir version, publicar imagen, microvm-images, lambda-microvms, sube la version, deploy, despliegue, code-artifact
---

# MicroVM Deploy

Empaqueta y publica una imagen de **AWS Lambda MicroVM** al bucket de artefactos,
con **versionado automático**, y entrega la guía de los comandos `aws lambda-microvms`
que el usuario debe correr después.

## Alcance (qué automatiza y qué no)

| Fase | Automatizado por el skill | Lo hace el usuario |
|------|---------------------------|--------------------|
| Validar profile/credenciales | ✅ | |
| Empaquetar `Dockerfile` + `app.py` en zip | ✅ | |
| Subir a S3 con versión incremental (`code-artifact-vN.zip`) | ✅ | |
| `create-microvm-image` / `update-microvm-image` | ❌ (guía) | ✅ |
| `run-microvm`, token, Caddy | ❌ (guía) | ✅ |

**Por qué la parte `lambda-microvms` es guía y no automatización:** el servicio
`aws lambda-microvms` es preview y **requiere un modelo de servicio registrado**
(`aws configure add-model`). Si la máquina actual no lo tiene, los comandos fallan
con `Found invalid choice 'lambda-microvms'`. El skill detecta esto y entrega los
comandos para que el usuario los corra donde el modelo esté disponible.

## Convenciones fijas (de este proyecto)

```
PROFILE   = sso-personal
REGION    = us-east-1
ACCOUNT   = 590183999298
BUCKET    = microvm-artifacts-590183999298-us-east-1
PREFIX    = microvm-images/<nombre-imagen>/
ARTIFACT  = code-artifact.zip  (v1) | code-artifact-vN.zip (incrementos)
```

Estructura real del bucket (validada):
```
s3://microvm-artifacts-590183999298-us-east-1/microvm-images/
├── code-server/   (code-artifact.zip, code-artifact-v2.zip ... v6)
├── hello-world/
└── kiro-sandbox/  (se crea en el primer deploy)
```

## Workflow

### 1. Verificar prerequisitos

```bash
# Identidad (debe devolver account 590183999298)
aws sts get-caller-identity --profile sso-personal

# ¿Está el servicio microvms disponible en esta máquina?
aws lambda-microvms help >/dev/null 2>&1 \
  && echo "lambda-microvms OK" \
  || echo "FALTA modelo lambda-microvms — solo se podrá subir el artefacto"
```

### 2. Empaquetar y subir (script incluido)

Ejecuta `deploy.sh <nombre-imagen> [ruta-del-proyecto]`:

```bash
bash ~/.kiro/skills/microvm-deploy/deploy.sh kiro-sandbox /Users/usuario/Documents/kiro-day-medellin-2026/kiro-sandbox
```

El script:
1. Valida que existan `Dockerfile` y `app.py` en la ruta.
2. Calcula la siguiente versión mirando lo que ya hay en `s3://.../microvm-images/<nombre>/`.
3. Crea el zip (`Dockerfile` + `app.py` en la raíz del zip — convención del steering).
4. Lo sube como `code-artifact.zip` (primera vez) o `code-artifact-vN.zip`.
5. Imprime el `s3://` URI resultante y la guía del paso 3.

### 3. Crear o actualizar la imagen (lo corre el usuario)

> **Primera vez** → `create-microvm-image` con `--additional-os-capabilities '["ALL"]'`
> (necesario para Docker anidado; **solo** funciona en create, no en update).

```bash
export AWS_PROFILE=sso-personal AWS_REGION=us-east-1 ACCOUNT_ID=590183999298
export BUCKET=microvm-artifacts-${ACCOUNT_ID}-${AWS_REGION}
IMAGE=kiro-sandbox
ARTIFACT=code-artifact.zip   # o code-artifact-vN.zip que imprimió el script

aws lambda-microvms create-microvm-image \
  --name $IMAGE \
  --description "VS Code web + Kiro CLI, floci, kubectl, k9s, AWS CLI" \
  --base-image-arn arn:aws:lambda:${AWS_REGION}:aws:microvm-image:al2023-1 \
  --build-role-arn arn:aws:iam::${ACCOUNT_ID}:role/MicroVMBuildRole \
  --code-artifact '{"uri":"s3://'$BUCKET'/microvm-images/'$IMAGE'/'$ARTIFACT'"}' \
  --additional-os-capabilities '["ALL"]' \
  --hooks '{"port":9000,"microvmImageHooks":{"ready":"ENABLED","readyTimeoutInSeconds":120},"microvmHooks":{"run":"ENABLED","runTimeoutInSeconds":60,"resume":"ENABLED","resumeTimeoutInSeconds":60,"suspend":"ENABLED","suspendTimeoutInSeconds":5,"terminate":"ENABLED","terminateTimeoutInSeconds":5}}'
```

> **Versiones siguientes** → `update-microvm-image` (reusa capabilities del create original):

```bash
aws lambda-microvms update-microvm-image \
  --image-identifier arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:microvm-image:$IMAGE \
  --code-artifact '{"uri":"s3://'$BUCKET'/microvm-images/'$IMAGE'/'$ARTIFACT'"}'
```

Esperar build (~5-8 min para kiro-sandbox):

```bash
aws lambda-microvms get-microvm-image \
  --image-identifier arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:microvm-image:$IMAGE \
  --query 'state' --output text
# PENDING -> IN_PROGRESS -> SUCCESSFUL
```

Si falla, revisar el motivo del build:
```bash
aws lambda-microvms list-microvm-image-builds \
  --image-identifier arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:microvm-image:$IMAGE \
  --query 'items[0].{state:buildState,reason:stateReason}'
```

### 4. Ejecutar y acceder (guía)

```bash
aws lambda-microvms run-microvm \
  --image-identifier arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:microvm-image:$IMAGE \
  --image-version 1.0 \
  --execution-role-arn arn:aws:iam::${ACCOUNT_ID}:role/MicroVMExecutionRole \
  --idle-policy '{"maxIdleDurationSeconds":3600,"suspendedDurationSeconds":1800,"autoResumeEnabled":true}'
```

Acceso con Caddy (code-server necesita WebSocket) y token (`create-microvm-auth-token`):
ver `kiro-sandbox/README.md`, sección "Acceder con Caddy".

## Limpieza de versiones viejas (evitar costo de storage)

El steering pide limpiar versiones no usadas. Para borrar artefactos viejos del bucket:

```bash
aws s3 rm s3://$BUCKET/microvm-images/$IMAGE/code-artifact-v2.zip --profile sso-personal
```

Y para borrar versiones de imagen no usadas:
```bash
aws lambda-microvms delete-microvm-image-version \
  --image-identifier arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:microvm-image:$IMAGE \
  --image-version <N>
```

## Notas

- El zip lleva `Dockerfile` y `app.py` en la **raíz** (no dentro de un subfolder).
- `arm64` + base `al2023-1` por convención del proyecto.
- No incrustar secretos en el artefacto: el snapshot se comparte entre MicroVMs.
