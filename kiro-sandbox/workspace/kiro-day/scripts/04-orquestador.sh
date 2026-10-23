#!/usr/bin/env bash
# =============================================================================
# ACTO 4 — "El orquestador" (Sub-agents)
# =============================================================================
# Historia: ya tenemos un equipo (arquitecto, backend-dev, frontend-dev,
# reviewer). Pero hasta ahora los usamos de a uno, cambiando con /agent swap.
# ¿Y si un 'tech lead' pudiera REPARTIR el trabajo entre ellos en paralelo y
# juntar los resultados? Eso son los SUB-AGENTS: un agente que delega tareas a
# otros, cada uno en su propio contexto aislado.
#
# Feature de Kiro: SUB-AGENTS. Un agente orquestador invoca a otros agentes
# como sub-agentes. Claves:
#   - El orquestador necesita la tool 'subagent' en su 'tools' (o @builtin).
#   - Se controla con toolsSettings.subagent: availableAgents (a quién puede
#     invocar) y trustedAgents (quién corre sin pedir confirmación).
#   - Cada sub-agente corre AISLADO (su propio contexto), pero COMPARTE
#     steering, MCP, acceso al workspace y permisos.
#   - Corren en PARALELO; el orquestador junta los resultados al final.
# =============================================================================

source "$(dirname "$0")/lib/common.sh"

title "ACTO 4 — El orquestador: coordinar el equipo con sub-agents"

story "Dónde vamos" \
  "Tenemos el equipo, pero lo usábamos de a uno. Ahora creamos un 'tech lead'" \
  "que REPARTE el trabajo: manda al backend-dev y al frontend-dev a construir" \
  "EN PARALELO, y al reviewer a auditar. Un agente que delega en otros."

explain "¿Qué es un sub-agent?" \
  "Un agente que se invoca desde OTRO agente para una tarea enfocada. El" \
  "orquestador detecta (o tú le pides) una tarea delegable, elige el agente" \
  "adecuado por su 'description', lo corre AISLADO y recibe el resultado." \
  "Sirve para paralelismo, herramientas especializadas y aislar contexto."

explain "Qué comparten y qué aíslan los sub-agents" \
  "  COMPARTEN: steering, servers MCP, acceso al workspace, permisos." \
  "  AÍSLAN:    historial de conversación y ventana de contexto (cada uno" \
  "             tiene la suya). Así no se 'contaminan' entre tareas." \
  "Correr 3 agentes en paralelo = 3 contextos independientes trabajando a la vez."

explain "Lo que hace falta para orquestar (2 cosas)" \
  "  1) El orquestador debe tener la tool 'subagent' en su 'tools'" \
  "     (o '@builtin'). Sin ella, NO puede delegar." \
  "  2) toolsSettings.subagent controla a quién invoca:" \
  "       availableAgents → patrones de qué agentes PUEDE invocar." \
  "       trustedAgents   → cuáles corren SIN pedir confirmación." \
  "Para restringir las TOOLS de un sub-agente, se configuran en SU propio" \
  "archivo, no en el del orquestador."

pause

AGENTS="$KIRO_DIR/agents"
mkdirp "$AGENTS"

# --- tech-lead.json: el orquestador ------------------------------------------
explain "Creamos el orquestador: tech-lead" \
  "Puede leer/buscar y, sobre todo, DELEGAR (tool 'subagent'). En" \
  "toolsSettings.subagent listamos a su equipo: arquitecto, backend-dev," \
  "frontend-dev y reviewer, todos de confianza para correr sin interrupciones."

TL="$AGENTS/tech-lead.json"
exists_note "$TL"
step "Creando ${TL}…"
cat > "$TL" <<'JSON'
{
  "name": "tech-lead",
  "description": "Líder técnico del POS: planifica y REPARTE el trabajo entre los especialistas (arquitecto, backend-dev, frontend-dev, reviewer), en paralelo, y consolida los resultados.",
  "prompt": "Eres el líder técnico del proyecto POS. No implementas tú: tu trabajo es ENTENDER la tarea, dividirla en subtareas y DELEGARLA en los agentes especialistas usando sub-agents. Corre en paralelo lo que sea independiente (p. ej. backend y frontend a la vez) y espera dependencias cuando las haya. Cuando los especialistas terminen, consolidas y resumes en español. Elige al agente por su rol: arquitecto (diseño), backend-dev (API/FastAPI), frontend-dev (React), reviewer (auditoría de solo lectura).",
  "tools": ["fs_read", "grep", "glob", "subagent", "@drawio"],
  "allowedTools": ["fs_read", "grep", "glob"],
  "toolsSettings": {
    "subagent": {
      "availableAgents": ["arquitecto", "backend-dev", "frontend-dev", "reviewer"],
      "trustedAgents": ["arquitecto", "backend-dev", "frontend-dev", "reviewer"]
    }
  }
}
JSON
ok "Creado: $TL"
show_file "$TL"

step "Validando el JSON del orquestador…"
python3 -c "import json; json.load(open('$TL')); print('JSON OK')" \
  && ok "tech-lead.json es válido." \
  || warn "tech-lead.json tiene un error de JSON."

pause

explain "Leamos la config del tech-lead" \
  "  tools incluye 'subagent' → SÍ puede delegar (sin esto, no podría)." \
  "  availableAgents → solo invoca a los 4 del equipo, a nadie más." \
  "  trustedAgents   → esos 4 corren sin pedirte permiso cada vez." \
  "Nota: cada especialista sigue limitado por SUS propias tools/permisos" \
  "(p. ej. el reviewer no podrá escribir aunque el tech-lead se lo pida)."

explain "Patrones de orquestación que soporta" \
  "  • Paralelo: varias subtareas independientes a la vez." \
  "  • Dependencias (DAG): planifica el grafo y corre en orden; lo paralelo" \
  "    en paralelo, lo dependiente esperando a su requisito." \
  "  • Review loops: una etapa puede devolver trabajo a otra (p. ej. el" \
  "    reviewer regresa al backend-dev con 'NEEDS_CHANGES') hasta N iteraciones." \
  "El grafo se planifica ANTES de arrancar; no se modifica a mitad de camino."

explain "Cómo probarlo en el chat" \
  "  kiro-cli --v3 chat --agent tech-lead" \
  "Pídele algo que reparta trabajo, por ejemplo:" \
  "  'Diseña y arma el MVP del POS: que el arquitecto proponga la arquitectura," \
  "   luego backend-dev y frontend-dev implementen EN PARALELO, y el reviewer" \
  "   audite el resultado.'" \
  "En CLI puedes vigilar sub-agentes largos con Ctrl+G." \
  "" \
  "Kiro también trae sub-agentes internos (context gathering y general purpose)" \
  "que usa solo, sin que los configures."

title "Acto 4 completado ✅"
explain "El equipo ya no solo existe: se auto-coordina. Ahora sumemos" \
  "conocimiento experto bajo demanda para esas tareas: las Skills." \
  "" \
  "➡  Siguiente: ./scripts/05-skills.sh (conocimiento experto bajo demanda)"
