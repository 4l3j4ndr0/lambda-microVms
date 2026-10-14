#!/usr/bin/env bash
#
# microvm-deploy — empaqueta Dockerfile + app.py y los sube versionados al bucket
# de artefactos de Lambda MicroVMs.
#
# Uso:
#   bash deploy.sh <nombre-imagen> [ruta-del-proyecto]
#
# Ejemplo:
#   bash deploy.sh kiro-sandbox /Users/usuario/Documents/kiro-day-medellin-2026/kiro-sandbox
#
# Si se omite la ruta, usa el directorio actual.
set -euo pipefail

# --- Convenciones del proyecto (fijas) ---------------------------------------
PROFILE="sso-personal"
REGION="us-east-1"
ACCOUNT="590183999298"
BUCKET="microvm-artifacts-${ACCOUNT}-${REGION}"
PREFIX_BASE="microvm-images"

# --- Args --------------------------------------------------------------------
IMAGE_NAME="${1:-}"
PROJECT_DIR="${2:-$(pwd)}"

if [[ -z "$IMAGE_NAME" ]]; then
  echo "ERROR: falta el nombre de la imagen." >&2
  echo "Uso: bash deploy.sh <nombre-imagen> [ruta-del-proyecto]" >&2
  exit 1
fi

if [[ ! -f "$PROJECT_DIR/Dockerfile" || ! -f "$PROJECT_DIR/app.py" ]]; then
  echo "ERROR: no encuentro Dockerfile y/o app.py en: $PROJECT_DIR" >&2
  exit 1
fi

S3_PREFIX="s3://${BUCKET}/${PREFIX_BASE}/${IMAGE_NAME}"

echo "==> Imagen:   $IMAGE_NAME"
echo "==> Proyecto: $PROJECT_DIR"
echo "==> Destino:  $S3_PREFIX/"

# --- 1. Validar identidad ----------------------------------------------------
echo "==> Verificando credenciales ($PROFILE)..."
CALLER_ACCOUNT="$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text 2>/dev/null || true)"
if [[ "$CALLER_ACCOUNT" != "$ACCOUNT" ]]; then
  echo "ERROR: el profile '$PROFILE' resuelve a la cuenta '$CALLER_ACCOUNT', se esperaba '$ACCOUNT'." >&2
  echo "       Corre: aws sso login --profile $PROFILE" >&2
  exit 1
fi
echo "    OK (account $CALLER_ACCOUNT)"

# --- 2. Calcular siguiente versión -------------------------------------------
# Lista los code-artifact*.zip existentes y determina el siguiente nombre.
echo "==> Calculando versión..."
EXISTING="$(aws s3 ls "$S3_PREFIX/" --profile "$PROFILE" 2>/dev/null | awk '{print $NF}' | grep -E '^code-artifact(-v[0-9]+)?\.zip$' || true)"

if [[ -z "$EXISTING" ]]; then
  ARTIFACT="code-artifact.zip"       # primera subida de esta imagen
else
  # Mayor N ya presente (code-artifact.zip cuenta como v1)
  MAX=1
  while IFS= read -r f; do
    if [[ "$f" == "code-artifact.zip" ]]; then
      n=1
    else
      n="$(echo "$f" | sed -E 's/^code-artifact-v([0-9]+)\.zip$/\1/')"
    fi
    [[ "$n" =~ ^[0-9]+$ ]] && (( n > MAX )) && MAX="$n"
  done <<< "$EXISTING"
  NEXT=$(( MAX + 1 ))
  ARTIFACT="code-artifact-v${NEXT}.zip"
fi
echo "    Siguiente artefacto: $ARTIFACT"

# --- 3. Empaquetar -----------------------------------------------------------
# Se empaqueta TODO el contexto de build del proyecto (igual que `docker build`),
# con el Dockerfile en la RAÍZ del zip (convención del steering). NO se usa `-j`
# (junk paths) ni se limita a Dockerfile+app.py: el Dockerfile puede hacer
# `COPY settings.json`, `COPY welcome/`, `COPY workspace/...`, etc., y si esos
# archivos no están en el zip el build falla con "not found" al calcular el
# checksum del COPY.
#
# Exclusiones: VCS, caches y artefactos que no son contexto de build. Si el
# proyecto trae un .dockerignore, también se respetan sus patrones.
echo "==> Empaquetando zip (contexto de build completo, Dockerfile en la raíz)..."
TMP_ZIP="$(mktemp -t "${IMAGE_NAME}-XXXX").zip"
trap 'rm -f "$TMP_ZIP"' EXIT

ZIP_EXCLUDES=(
  '.git/*' '*/.git/*'
  '__pycache__/*' '*/__pycache__/*' '*.pyc'
  'node_modules/*' '*/node_modules/*'
  '*.DS_Store' '*/.DS_Store'
  '.venv/*' '*/.venv/*'
)

# Si hay .dockerignore, añade sus patrones (ignora comentarios y líneas vacías).
if [[ -f "$PROJECT_DIR/.dockerignore" ]]; then
  while IFS= read -r pat; do
    [[ -z "$pat" || "$pat" == \#* ]] && continue
    ZIP_EXCLUDES+=("$pat" "${pat%/}/*")
  done < "$PROJECT_DIR/.dockerignore"
fi

( cd "$PROJECT_DIR" && zip -q -r "$TMP_ZIP" . -x "${ZIP_EXCLUDES[@]}" )

# Verificación: el Dockerfile DEBE quedar en la raíz del zip.
if ! unzip -l "$TMP_ZIP" | awk '{print $NF}' | grep -qx "Dockerfile"; then
  echo "ERROR: el Dockerfile no quedó en la raíz del zip." >&2
  exit 1
fi
echo "    $(du -h "$TMP_ZIP" | awk '{print $1}') -> $TMP_ZIP"
echo "    Archivos empaquetados:"
unzip -l "$TMP_ZIP" | awk 'NR>3 && $NF!="" && $NF!~"----" {print "      "$NF}' | head -40

# --- 4. Subir ----------------------------------------------------------------
S3_URI="${S3_PREFIX}/${ARTIFACT}"
echo "==> Subiendo a $S3_URI ..."
aws s3 cp "$TMP_ZIP" "$S3_URI" --profile "$PROFILE"
echo "    OK"

# --- 5. Guía siguiente paso --------------------------------------------------
IMAGE_ARN="arn:aws:lambda:${REGION}:${ACCOUNT}:microvm-image:${IMAGE_NAME}"
HAS_SVC="no"
aws lambda-microvms help >/dev/null 2>&1 && HAS_SVC="yes"

cat <<EOF

===========================================================================
 Artefacto publicado:
   $S3_URI
===========================================================================

EOF

if [[ "$HAS_SVC" == "no" ]]; then
  cat <<EOF
AVISO: 'aws lambda-microvms' no está disponible en esta máquina
(falta el modelo de servicio preview). Corre los siguientes comandos en una
máquina donde el servicio esté registrado (aws configure add-model).

EOF
fi

if [[ "$ARTIFACT" == "code-artifact.zip" ]]; then
  cat <<EOF
Siguiente paso — CREAR la imagen (primera versión):

  aws lambda-microvms create-microvm-image \\
    --name $IMAGE_NAME \\
    --description "$IMAGE_NAME microVM" \\
    --base-image-arn arn:aws:lambda:${REGION}:aws:microvm-image:al2023-1 \\
    --build-role-arn arn:aws:iam::${ACCOUNT}:role/MicroVMBuildRole \\
    --code-artifact '{"uri":"$S3_URI"}' \\
    --additional-os-capabilities '["ALL"]' \\
    --hooks '{"port":9000,"microvmImageHooks":{"ready":"ENABLED","readyTimeoutInSeconds":120},"microvmHooks":{"run":"ENABLED","runTimeoutInSeconds":60,"resume":"ENABLED","resumeTimeoutInSeconds":60,"suspend":"ENABLED","suspendTimeoutInSeconds":5,"terminate":"ENABLED","terminateTimeoutInSeconds":5}}' \\
    --profile $PROFILE --region $REGION
EOF
else
  cat <<EOF
Siguiente paso — ACTUALIZAR la imagen (nueva versión):

  aws lambda-microvms update-microvm-image \\
    --image-identifier $IMAGE_ARN \\
    --code-artifact '{"uri":"$S3_URI"}' \\
    --profile $PROFILE --region $REGION
EOF
fi

cat <<EOF

Monitorear el build:

  aws lambda-microvms get-microvm-image \\
    --image-identifier $IMAGE_ARN \\
    --query 'state' --output text \\
    --profile $PROFILE --region $REGION

(PENDING -> IN_PROGRESS -> SUCCESSFUL)
===========================================================================
EOF
