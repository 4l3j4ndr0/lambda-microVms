#!/usr/bin/env bash
# =============================================================================
# ACTO 6 — "Automatización del equipo" (Hooks)
# =============================================================================
# Historia: el equipo ya construye el POS. Pero queremos que ciertas cosas
# pasen SOLAS, sin pedirlas: que se corran los tests cada vez que un dev escribe
# código, y que se BLOQUEEN operaciones peligrosas antes de que ocurran. Eso es
# contratar a nuestro "QA automático" y a nuestro "guardia de seguridad".
#
# Feature de Kiro: HOOKS — archivos .kiro/hooks/<id>.json (schema CLI v3) que
# ejecutan un comando o inyectan un prompt cuando pasa un evento del ciclo de
# vida del agente. Estructura:
#   { "version": "v1", "hooks": [ { name, trigger, matcher?, action } ] }
# Triggers (PascalCase): AgentSpawn, UserPromptSubmit, PreToolUse, PostToolUse,
#   Stop, PostFileSave, ...
# action.type: "command" (shell, recibe el evento por STDIN) o "agent" (prompt).
# PreToolUse puede BLOQUEAR el tool (exit 2 = deny; fail-closed).
# =============================================================================

source "$(dirname "$0")/lib/common.sh"

title "ACTO 6 — Automatización del equipo (Hooks)"

story "Dónde vamos" \
  "Dos automatizaciones que todo equipo quiere:" \
  "  • QA automático: correr los tests cada vez que se escribe código." \
  "  • Guardia de seguridad: impedir comandos peligrosos ANTES de ejecutarlos." \
  "Con hooks, Kiro las dispara solo cuando ocurre el evento."

explain "¿Qué es un Hook?" \
  "Un comando (o prompt) que se ejecuta AUTOMÁTICAMENTE en un punto del ciclo" \
  "de vida del agente: cuando escribe un archivo, antes/después de usar una" \
  "herramienta, al terminar un turno, al arrancar la sesión…" \
  "Como los git hooks, pero para tu asistente de IA."

explain "Estructura de un archivo de hooks (.kiro/hooks/<id>.json)" \
  "  version → 'v1'" \
  "  hooks[] → lista; un archivo puede definir varios" \
  "    name    → nombre del hook" \
  "    trigger → evento (PascalCase): PreToolUse, PostToolUse, Stop, …" \
  "    matcher → (opcional) a qué herramienta aplica: fs_write, execute_bash…" \
  "    action  → { type: 'command'|'agent', command|prompt }"

explain "Eventos más usados" \
  "  AgentSpawn       → al iniciar el agente (inyectar contexto)" \
  "  UserPromptSubmit → al enviar tú un prompt (puede bloquearlo)" \
  "  PreToolUse       → ANTES de usar una tool → puede BLOQUEAR (exit 2)" \
  "  PostToolUse      → DESPUÉS de usar una tool (validar/testear)" \
  "  Stop             → al terminar el turno del asistente"

pause

HOOKS="$KIRO_DIR/hooks"
mkdirp "$HOOKS"

# --- Hook 1: QA automático (PostToolUse sobre fs_write) ----------------------
explain "Hook 1/2 — QA automático (PostToolUse)" \
  "Cada vez que un agente ESCRIBE un archivo (matcher: fs_write), corremos los" \
  "tests del backend. Si existen y fallan, el agente ve la salida y se corrige." \
  "Usamos un comando defensivo: si aún no hay tests, no rompe nada."

QA="$HOOKS/qa-tests.json"
exists_note "$QA"
step "Creando ${QA}…"
cat > "$QA" <<'JSON'
{
  "version": "v1",
  "hooks": [
    {
      "name": "qa-tests-on-write",
      "trigger": "PostToolUse",
      "matcher": "fs_write",
      "action": {
        "type": "command",
        "command": "if [ -f pytest.ini ] || [ -d tests ]; then pytest -q 2>&1 | tail -20; else echo 'Sin tests aún — nada que correr.'; fi"
      }
    }
  ]
}
JSON
ok "Creado: $QA"
show_file "$QA"
pause

# --- Hook 2: guardia de seguridad (PreToolUse sobre execute_bash) ------------
explain "Hook 2/2 — Guardia de seguridad (PreToolUse, BLOQUEANTE)" \
  "ANTES de ejecutar un comando de shell, revisamos si es peligroso." \
  "Si el guardia termina con exit 2, el comando se BLOQUEA (no se ejecuta)." \
  "PreToolUse es 'fail-closed': si el hook no puede dar veredicto, bloquea." \
  "Así protegemos el proyecto de un 'rm -rf' aunque alguien lo pida por error."

GUARD="$HOOKS/guard-shell.json"
exists_note "$GUARD"
step "Creando ${GUARD}…"
# El hook recibe el evento (JSON) por STDIN. Buscamos patrones peligrosos con
# grep -E sobre el texto crudo del evento; si alguno aparece, exit 2 => BLOQUEA.
# grep -q devuelve 0 si HAY match, así que invertimos: si matchea, escribimos a
# STDERR y salimos con 2; si no, exit 0 (permite). Es legible y sin comillas
# infernales (mejor para explicar en el taller que un one-liner de python).
cat > "$GUARD" <<'JSON'
{
  "version": "v1",
  "hooks": [
    {
      "name": "guard-dangerous-shell",
      "trigger": "PreToolUse",
      "matcher": "execute_bash",
      "action": {
        "type": "command",
        "command": "evt=$(cat); if printf '%s' \"$evt\" | grep -Eq 'rm +-rf +[/~]|mkfs|dd +if=|:\\(\\)\\{'; then echo 'BLOQUEADO: patron peligroso detectado en el comando.' >&2; exit 2; fi; exit 0"
      }
    }
  ]
}
JSON
ok "Creado: $GUARD"
show_file "$GUARD"
pause

# --- Validación JSON ---------------------------------------------------------
step "Validando el JSON de los hooks…"
all_ok=1
for f in "$HOOKS"/*.json; do
  if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$f" 2>/dev/null; then
    ok "válido: $(basename "$f")"
  else
    warn "INVÁLIDO: $(basename "$f")"
    all_ok=0
  fi
done
[ "$all_ok" = "1" ] && ok "Todos los hooks tienen JSON válido."

explain "Cómo probarlos" \
  "Los hooks se activan al INICIAR la sesión. Abre kiro-cli --v3 chat y:" \
  "  • Pídele a backend-dev que cree un archivo → al escribir, corre el QA." \
  "  • Pídele que ejecute 'rm -rf /' → el guardia lo BLOQUEA antes de correr." \
  "Nota: el matcher usa nombres canónicos o alias (fs_write / write, etc.)."

warn "Ojo: PreToolUse es fail-closed. Si tu guardia tiene un bug y no corre," \
     "    bloqueará TODOS los execute_bash. Pruébalo antes de confiar en él."

title "Acto 6 completado ✅"
explain "Ya automatizamos QA y seguridad. Hasta aquí Kiro trabaja con archivos y" \
  "shell. El siguiente salto: conectarlo a herramientas y datos EXTERNOS" \
  "(documentación de AWS, bases de datos, etc.) vía MCP." \
  "" \
  "➡  Siguiente: ./scripts/07-mcp.sh (herramientas externas con MCP)"
