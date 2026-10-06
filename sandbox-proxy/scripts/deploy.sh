#!/bin/bash
set -euo pipefail

# =============================================================================
# Deploy del sandbox-proxy (Kiro Day) a EC2 vía AWS SSM (sin SSH).
#
# Uso:   ./scripts/deploy.sh [rama]
#        ./scripts/deploy.sh main   → producción (por defecto)
#
# Requisitos previos EN LA INSTANCIA:
#   - Docker y el rol de instancia con permisos SSM.
#   - El rol de instancia con permisos lambda-microvms:CreateMicrovmAuthToken
#     (el proxy genera/renueva tokens usando el rol, NO claves en disco).
#   - El archivo .env ya presente en ${APP_DIR}/source/sandbox-proxy/.env
#     (NO se versiona; se coloca manualmente — ver .env.example).
#   - routes.json se monta como volumen (lo escribe provision.js; no se versiona).
#
# Requisitos previos LOCALES:
#   - AWS CLI configurado con el perfil indicado.
# =============================================================================

INSTANCE_ID="i-02df93e0743fa1e9a"          # Ingenis Server
PROFILE="sso-personal"
BRANCH="${1:-main}"
REPO="git@github.com:4l3j4ndr0/lambda-microVms.git"

APP_DIR="/root/sandbox-proxy"
CONTAINER_NAME="sandbox-proxy"
IMAGE_TAG="sandbox-proxy"
# Puerto interno del proxy (solo localhost; nginx hace proxy_pass hacia aquí).
PORT=8443

echo "🚀 Deploying ${CONTAINER_NAME} (branch: $BRANCH, port: $PORT) via SSM..."

PARAMS_FILE=$(mktemp)
cat > "$PARAMS_FILE" <<EOF
{
  "commands": [
    "#!/bin/bash",
    "set -e",
    "mkdir -p ${APP_DIR} && cd ${APP_DIR} && (if [ -d source ]; then cd source && git fetch origin && git reset --hard origin/${BRANCH}; else git clone -b ${BRANCH} ${REPO} source; fi) && cd ${APP_DIR}/source/sandbox-proxy && if [ ! -f .env ]; then echo MISSING_ENV && exit 1; fi && touch routes.json && docker stop ${CONTAINER_NAME} 2>/dev/null && docker rm ${CONTAINER_NAME} 2>/dev/null || true && docker build --no-cache -t ${IMAGE_TAG} . && docker run -d --name ${CONTAINER_NAME} --restart unless-stopped --env-file .env -v \$(pwd)/routes.json:/app/routes.json -p 127.0.0.1:${PORT}:${PORT} ${IMAGE_TAG} && echo DEPLOY_SUCCESS"
  ]
}
EOF

COMMAND_ID=$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --timeout-seconds 600 \
  --profile "$PROFILE" \
  --parameters "file://$PARAMS_FILE" \
  --query "Command.CommandId" --output text)

rm -f "$PARAMS_FILE"

echo "⏳ Esperando resultado (Command: $COMMAND_ID)..."

while true; do
  STATUS=$(aws ssm get-command-invocation \
    --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE_ID" \
    --profile "$PROFILE" \
    --query "Status" --output text 2>/dev/null || echo "Pending")

  if [ "$STATUS" = "Success" ] || [ "$STATUS" = "Failed" ] || [ "$STATUS" = "TimedOut" ]; then
    break
  fi
  echo "   Status: $STATUS..."
  sleep 10
done

echo ""
echo "📋 Status: $STATUS"

if [ "$STATUS" = "Success" ]; then
  OUTPUT=$(AWS_PAGER="" aws ssm get-command-invocation \
    --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE_ID" \
    --profile "$PROFILE" \
    --query "StandardOutputContent" --output text)
  echo "$OUTPUT"
  echo "✅ Deploy exitoso (${CONTAINER_NAME} en puerto $PORT)"
else
  OUTPUT=$(AWS_PAGER="" aws ssm get-command-invocation \
    --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE_ID" \
    --profile "$PROFILE" \
    --query "StandardErrorContent" --output text)
  echo "$OUTPUT"
  echo "❌ Deploy falló"
  exit 1
fi
