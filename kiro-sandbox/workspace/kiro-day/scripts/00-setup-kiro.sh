#!/usr/bin/env bash
# =============================================================================
# ACTO 0 — "Llegó la idea"
# =============================================================================
# Historia: tenemos una idea de negocio (un sistema POS para una tienda) pero
# NO sabemos de desarrollo ni de cloud. En vez de contratar un equipo humano,
# vamos a armar un EQUIPO DE ESPECIALISTAS con Kiro. Pero antes de contratar a
# nadie, necesitamos montar "la oficina": la estructura .kiro/ donde vivirán las
# reglas, los agentes, el conocimiento y la automatización del equipo.
#
# Feature de Kiro que presenta este acto: la estructura de configuración .kiro/
# y los SCOPES (workspace vs global), más el archivo de settings.
# =============================================================================

source "$(dirname "$0")/lib/common.sh"

title "ACTO 0 — Llegó la idea: montamos la oficina (.kiro/)"

story "El escenario" \
  "Queremos construir un POS (punto de venta) para una tienda." \
  "No sabemos de arquitectura cloud ni de código." \
  "La estrategia: usar Kiro para crear un equipo de agentes especialistas" \
  "que nos acompañen de la idea hasta el despliegue."

explain "¿Qué es Kiro CLI?" \
  "Un asistente de desarrollo agéntico que vive en tu terminal." \
  "Lee y escribe archivos, ejecuta comandos, busca en tu código y se" \
  "conecta a herramientas externas — todo por conversación natural." \
  "Lo potente: podemos CONFIGURARLO para nuestro proyecto."

explain "¿Dónde se configura? → la carpeta .kiro/" \
  "Todo lo que personaliza a Kiro vive en una carpeta '.kiro/' en la raíz" \
  "del proyecto. Piensa en ella como la oficina de nuestro equipo:" \
  "  steering/  → las reglas de la casa (estándares que todos siguen)" \
  "  agents/    → los especialistas que vamos a 'contratar'" \
  "  skills/    → manuales de conocimiento experto bajo demanda" \
  "  hooks/     → automatización (nuestro QA / asistentes de proceso)" \
  "  settings/  → configuración (incluye conexión a herramientas: MCP)"

explain "Scopes: workspace vs global" \
  "  .kiro/ en el proyecto   → aplica SOLO a este proyecto (lo de hoy)." \
  "  ~/.kiro/ en tu home      → aplica a TODOS tus proyectos (global)." \
  "Hoy trabajamos en el scope de proyecto para no afectar otras cosas."

pause

# --- Crear la estructura -----------------------------------------------------
step "Creando la estructura .kiro/ del proyecto…"
mkdirp "$KIRO_DIR/steering"
mkdirp "$KIRO_DIR/agents"
mkdirp "$KIRO_DIR/skills"
mkdirp "$KIRO_DIR/hooks"
mkdirp "$KIRO_DIR/settings"
mkdirp "$KIRO_DIR/specs"

# --- settings: placeholder de MCP (lo llenamos en el acto de MCP) ------------
# Creamos settings/mcp.json vacío pero válido, para que el acto de MCP solo
# tenga que agregarle un servidor. Un JSON válido vacío evita errores de parseo.
MCP_FILE="$KIRO_DIR/settings/mcp.json"
exists_note "$MCP_FILE"
step "Creando settings/mcp.json (vacío por ahora)…"
cat > "$MCP_FILE" <<'JSON'
{
  "mcpServers": {}
}
JSON
ok "Creado: $MCP_FILE"

# --- Un README dentro de .kiro/ que documenta la oficina ---------------------
README_KIRO="$KIRO_DIR/README.md"
step "Creando .kiro/README.md (mapa de la oficina)…"
cat > "$README_KIRO" <<'MD'
# .kiro/ — la oficina de nuestro equipo de agentes

Esta carpeta configura cómo Kiro trabaja en este proyecto (POS).

| Carpeta      | Rol en el equipo                          | Feature de Kiro |
|--------------|-------------------------------------------|-----------------|
| `steering/`  | Las reglas de la casa / estándares        | Steering        |
| `agents/`    | Los especialistas (arquitecto, backend…)  | Custom Agents   |
| `skills/`    | Manuales de conocimiento bajo demanda     | Skills          |
| `hooks/`     | Automatización por eventos (QA, logs)     | Hooks           |
| `settings/`  | Configuración (p. ej. `mcp.json`)         | Settings / MCP  |
| `specs/`     | Features estructuradas (req → diseño → tareas) | Specs      |

> Scope: este `.kiro/` aplica solo a este proyecto. `~/.kiro/` sería global.
MD
ok "Creado: $README_KIRO"

pause

# --- Mostrar el resultado ----------------------------------------------------
explain "Esto es lo que acabamos de crear:"
if command -v tree >/dev/null 2>&1; then
  tree -a "$KIRO_DIR"
else
  find "$KIRO_DIR" -print | sed "s|$WORKSHOP_ROOT/||" | sort | sed 's/^/   /'
fi

show_file "$MCP_FILE"

title "Acto 0 completado ✅"
explain "La oficina está lista. Pero una oficina vacía no construye nada." \
  "Antes de contratar especialistas, hay que definir CÓMO trabaja el equipo:" \
  "el stack, las convenciones, el idioma. Eso es lo próximo." \
  "" \
  "➡  Siguiente: ${BOLD}./scripts/01-steering.sh${RESET} (las reglas de la casa)"
