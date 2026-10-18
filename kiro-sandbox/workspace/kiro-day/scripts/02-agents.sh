#!/usr/bin/env bash
# =============================================================================
# ACTO 2 — "Contratamos al primer especialista" (Custom Agents)
# =============================================================================
# Historia: ya tenemos oficina (Acto 0) y reglas de la casa (Acto 1). Nosotros
# no sabemos de cloud, así que lo primero que necesitamos es un ARQUITECTO que
# nos proponga cómo construir el POS. En vez de un chat genérico, "contratamos"
# un especialista: un agente con un rol claro, un prompt enfocado, herramientas
# acotadas y contexto precargado (nuestro steering).
#
# Feature de Kiro: CUSTOM AGENTS — configs JSON en .kiro/agents/. Campos clave:
#   name         → identificador del agente (se usa con --agent / /agent swap)
#   description  → una línea de para qué sirve
#   prompt       → el "rol": instrucciones de sistema que lo enfocan
#   tools        → qué herramientas PUEDE usar
#   allowedTools → cuáles se auto-aprueban (sin pedir confirmación)
#   resources    → archivos precargados en su contexto al arrancar
# =============================================================================

source "$(dirname "$0")/lib/common.sh"

title "ACTO 2 — Contratamos al primer especialista: el Arquitecto"

story "Dónde vamos" \
  "Tenemos la idea del POS y las reglas de la casa, pero no sabemos de cloud." \
  "Necesitamos un arquitecto que traduzca 'quiero un POS' en una arquitectura" \
  "concreta y explicada para no-técnicos. Vamos a 'contratarlo' como agente."

explain "¿Qué es un Custom Agent?" \
  "Un asistente especializado con un ROL fijo. En vez del chat genérico," \
  "obtienes un experto con: prompt enfocado, herramientas acotadas y" \
  "contexto precargado. Piensa en 'roles': arquitecto, backend, reviewer…" \
  "Mismo Kiro, distinto foco."

explain "Campos de la config (JSON en .kiro/agents/)" \
  "  name         → cómo lo invocas: kiro-cli --v3 chat --agent arquitecto" \
  "  description  → para qué sirve (una línea)" \
  "  prompt       → su rol / instrucciones de sistema" \
  "  tools        → qué PUEDE hacer" \
  "  allowedTools → qué se auto-aprueba (sin pedir permiso)" \
  "  resources    → archivos que ve desde el arranque (¡su contexto!)"

explain "Decisión de diseño: el arquitecto es de 'solo lectura y diseño'" \
  "Le damos tools para LEER el proyecto y buscar, pero NO para ejecutar" \
  "comandos ni escribir código. Su trabajo es PENSAR y PROPONER, no construir." \
  "Esto es seguridad por diseño: cada especialista solo con lo que necesita."

explain "IMPORTANTE — qué NO poner en el agente" \
  "  • El STEERING no se declara en el agente: se carga solo por su 'inclusion'" \
  "    (always/fileMatch/…). Meterlo con file:// lo cargaría a la fuerza y" \
  "    gastaría contexto en cada request. El arquitecto YA ve producto.md y" \
  "    tech.md porque son 'inclusion: always'." \
  "  • El campo 'resources' es para referenciar SKILLS con el esquema skill://," \
  "    no para archivos de steering. (Fuente: schema oficial de agentes Kiro.)" \
  "El arquitecto no necesita skills aún, así que va sin 'resources'."

pause

AGENTS="$KIRO_DIR/agents"
mkdirp "$AGENTS"

# --- arquitecto.json ---------------------------------------------------------
ARQ="$AGENTS/arquitecto.json"
exists_note "$ARQ"
step "Creando ${ARQ}…"
cat > "$ARQ" <<'JSON'
{
  "name": "arquitecto",
  "description": "Arquitecto de soluciones AWS para el POS. Propone y explica arquitectura; no escribe código.",
  "prompt": "Eres un arquitecto de soluciones AWS senior, especializado en explicar a personas SIN experiencia técnica. Tu trabajo es proponer la arquitectura del sistema POS, justificar cada decisión en lenguaje simple y señalar costos y riesgos. Respeta siempre el stack definido en el steering del proyecto (React + FastAPI + DynamoDB + AWS serverless). Cuando propongas algo, explica el porqué y las alternativas. No escribes código de aplicación: tu entregable son diagramas en texto, decisiones y pasos. Responde en español.",
  "tools": ["fs_read", "grep", "glob", "code"],
  "allowedTools": ["fs_read", "grep", "glob", "code"]
}
JSON
ok "Creado: $ARQ"
show_file "$ARQ"

# Validar que el JSON es correcto (si el agente tiene un typo, Kiro no lo carga).
step "Validando que el JSON sea válido…"
if command -v python3 >/dev/null 2>&1; then
  python3 -c "import json,sys; json.load(open('$ARQ')); print('JSON OK')" \
    && ok "El JSON del agente es válido." \
    || warn "El JSON tiene un error — Kiro no podría cargar el agente."
else
  warn "python3 no disponible; omito la validación de JSON."
fi

pause

explain "Cómo usar al arquitecto recién contratado" \
  "Listar agentes disponibles:   (dentro del chat)  /agent list" \
  "Arrancar el chat con él:       kiro-cli --v3 chat --agent arquitecto" \
  "Cambiar a él en caliente:      /agent swap arquitecto" \
  "" \
  "Pídele algo como:" \
  "  'Propón la arquitectura del POS y explícamela como si no supiera de cloud.'" \
  "Verás que ya conoce el producto y el stack: los precargamos en 'resources'."

title "Acto 2 completado ✅"
explain "Ya tenemos a nuestro primer especialista. Pero un arquitecto solo no" \
  "construye el POS: necesita un equipo que implemente lo que diseñó." \
  "" \
  "➡  Siguiente: ./scripts/03-agents-equipo.sh (backend, frontend y reviewer)"
