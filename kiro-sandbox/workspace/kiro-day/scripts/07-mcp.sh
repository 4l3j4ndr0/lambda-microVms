#!/usr/bin/env bash
# =============================================================================
# ACTO 7 — "Herramientas externas" (MCP)
# =============================================================================
# Historia: hasta ahora el equipo trabaja con archivos y shell. Pero el
# arquitecto, cuando explica la arquitectura del POS, lo hace en TEXTO. Sería
# mucho mejor que pudiera DIBUJAR diagramas. Le damos esa superpotencia
# conectando una herramienta externa vía MCP: el servidor de draw.io, que
# renderiza diagramas a partir de una descripción.
#
# Feature de Kiro: MCP (Model Context Protocol) — conecta Kiro a servidores
# externos que exponen herramientas, prompts y recursos. La config vive en
# .kiro/settings/mcp.json (que creamos vacío en el Acto 0).
#
# Dos tipos de server:
#   - Local  → se lanza como proceso: command + args + env
#   - Remoto → endpoint HTTPS (Streamable HTTP): url + headers. SIN instalar nada.
# draw.io es REMOTO: https://mcp.draw.io/mcp
# =============================================================================

source "$(dirname "$0")/lib/common.sh"

title "ACTO 7 — Herramientas externas: dibujar diagramas con MCP (draw.io)"

story "Dónde vamos" \
  "El arquitecto explica la arquitectura del POS en texto. Queremos que la" \
  "DIBUJE. Conectamos el MCP de draw.io: con él, cualquier agente puede" \
  "generar diagramas (de arquitectura, de flujo de una venta, del modelo de" \
  "datos en DynamoDB…) a partir de una descripción."

explain "¿Qué es MCP?" \
  "Model Context Protocol: un estándar para conectar Kiro a servidores" \
  "externos que exponen HERRAMIENTAS. Sin MCP, Kiro solo tiene archivos y" \
  "shell. Con MCP puede 'dibujar un diagrama', 'consultar la base de datos'," \
  "'buscar en la documentación de AWS', etc. — llamando al server correcto."

explain "Dónde se configura y qué tipos hay" \
  "Archivo: .kiro/settings/mcp.json (lo creamos vacío en el Acto 0)." \
  "  Local   → Kiro lanza un proceso:  command + args + env" \
  "  Remoto  → endpoint HTTPS (Streamable HTTP): url + headers. Sin instalar." \
  "draw.io es REMOTO: basta la URL. Cero instalación — ideal para el sandbox."

pause

SETTINGS="$KIRO_DIR/settings"
mkdirp "$SETTINGS"
MCP_FILE="$SETTINGS/mcp.json"

explain "Escribimos la config del server draw.io en mcp.json" \
  "Campos de un server REMOTO en Kiro:" \
  "  url          → el endpoint HTTPS del server" \
  "  autoApprove  → herramientas que NO piden confirmación (usamos las del" \
  "                 render de diagramas, que son seguras: solo generan XML)." \
  "  disabled     → para apagarlo sin borrarlo (lo dejamos en false)."

step "Escribiendo ${MCP_FILE}…"
cat > "$MCP_FILE" <<'JSON'
{
  "mcpServers": {
    "drawio": {
      "url": "https://mcp.draw.io/mcp",
      "disabled": false,
      "autoApprove": ["create_diagram", "get_drawio_reference"]
    }
  }
}
JSON
ok "Creado: $MCP_FILE"
show_file "$MCP_FILE"

step "Validando el JSON…"
python3 -c "import json; json.load(open('$MCP_FILE')); print('JSON OK')" \
  && ok "mcp.json es válido." \
  || warn "mcp.json tiene un error de JSON."

pause

explain "Las herramientas que aporta draw.io" \
  "  create_diagram        → genera un diagrama desde draw.io XML o Mermaid." \
  "  get_drawio_reference  → referencia de sintaxis (XML / Mermaid)." \
  "En hosts compatibles el diagrama se ve INLINE; en una terminal (como este" \
  "sandbox) devuelve un enlace que abre el diagrama en draw.io."

explain "Cómo usarlo en el chat" \
  "  1) Reinicia/entra a kiro-cli --v3 chat para que cargue el nuevo server." \
  "  2) Comprueba la conexión:   /mcp list" \
  "  3) Pídele al arquitecto:" \
  "     'Dibuja un diagrama de la arquitectura del POS: React → API Gateway →" \
  "      Lambda (FastAPI) → DynamoDB. Usa Mermaid.'" \
  "  4) O el flujo de una venta, o el modelo de datos. ¡Ahora el equipo dibuja!"

warn "autoApprove solo para herramientas seguras. create_diagram solo genera" \
     "    diagramas (no toca tu sistema), por eso es seguro auto-aprobarlo."

title "Acto 7 completado ✅"
explain "El equipo ya tiene reglas, especialistas, conocimiento, automatización y" \
  "herramientas externas. Pero con tanto poder (escribir, ejecutar, red)… hay" \
  "que definir QUÉ puede y QUÉ NO puede hacer. Hablemos de seguridad y permisos." \
  "" \
  "➡  Siguiente: ./scripts/08-permisos.sh (seguridad: permisos del equipo)"
