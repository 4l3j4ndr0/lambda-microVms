#!/usr/bin/env bash
# =============================================================================
# ACTO 9 — "Empaquetar y compartir el equipo" (Powers)
# =============================================================================
# Historia: montamos a mano reglas (steering), especialistas (agents), manuales
# (skills), automatización (hooks) y una herramienta externa (MCP de draw.io).
# ¿Y si quisiéramos reusar todo eso en OTRO proyecto, o compartirlo con otra
# persona que arranca su propio POS? ¿O instalar el "equipo POS de un experto"
# sin armarlo pieza por pieza? Para eso están los POWERS: bundles instalables.
#
# Feature de Kiro: POWERS — paquetes que agrupan documentación/steering + MCP
# servers + workflows en una unidad que Kiro activa POR KEYWORDS (como una skill
# pero empaquetando también MCP). Un power es un directorio con:
#   POWER.md   (requerido) → frontmatter + instrucciones de steering/workflows
#   mcp.json   (opcional)  → servers MCP que trae el power
# Se instalan con:  /powers install <nombre|ruta>   (y /powers uninstall).
# =============================================================================

source "$(dirname "$0")/lib/common.sh"

title "ACTO 9 — Empaquetar y compartir el equipo (Powers)"

story "Dónde vamos" \
  "Nuestro equipo POS vive suelto en .kiro/ (steering, agents, skills…)." \
  "Dos necesidades reales:" \
  "  1) Reusar todo esto en otro proyecto o compartirlo con un colega." \
  "  2) Instalar 'equipos' ya armados por expertos (Stripe, Figma, AWS…)." \
  "Los Powers resuelven ambas: empaquetan capacidades instalables."

explain "¿Qué es un Power?" \
  "Un bundle que agrupa en UNA unidad: documentación/steering, workflows y" \
  "—si hace falta— servers MCP. Kiro lo activa POR KEYWORDS, como una skill," \
  "pero un power puede traer TAMBIÉN sus herramientas MCP y buenas prácticas." \
  "Sirve para empaquetar TU conocimiento y para instalar el de terceros."

explain "Power vs Skill vs MCP — ¿en qué se diferencian?" \
  "  Skill → conocimiento (texto) que se carga on-demand." \
  "  MCP   → herramientas externas (tools) que Kiro puede invocar." \
  "  Power → EMPAQUETA ambos + workflows + onboarding en algo instalable y" \
  "          compartible. Es la unidad de distribución de capacidades." \
  "Pensalo así: un power es 'una skill con pilas incluidas' que puedes repartir."

explain "¿Por qué importa? (el problema que resuelven)" \
  "Conectar 5 MCP sueltos puede cargar 100+ definiciones de tools y comerse" \
  "~40% del contexto ANTES de tu primer prompt. Los powers cargan solo lo" \
  "relevante según la conversación: mantienen el agente enfocado."

pause

POWERS="$KIRO_DIR/powers"
mkdirp "$POWERS"

# --- Creamos un power propio: 'pos-kit' --------------------------------------
explain "Creamos nuestro propio power: 'pos-kit'" \
  "Empaqueta el conocimiento del POS + el MCP de diagramas, para instalarlo" \
  "en cualquier proyecto nuevo. Estructura: una carpeta con POWER.md y mcp.json."

POS_KIT="$POWERS/pos-kit"
mkdirp "$POS_KIT"

# POWER.md — metadata + steering/workflows del power
POWER_MD="$POS_KIT/POWER.md"
exists_note "$POWER_MD"
step "Creando ${POWER_MD}…"
cat > "$POWER_MD" <<'MD'
---
name: "pos-kit"
displayName: "POS Starter Kit"
description: "Equipo y buenas prácticas para construir un POS (punto de venta) en AWS serverless: producto, stack, modelado de datos y diagramas."
keywords: ["pos", "punto de venta", "caja", "ventas", "inventario", "dynamodb"]
---

# Onboarding

## Paso 1: Define tu tienda
Al activarse este power, Kiro te ayudará a concretar: qué vendes, quién usa el
POS (cajero/dueño) y qué reportes necesitas.

# Steering Instructions

Eres un acompañante experto para construir un POS en AWS serverless, dirigido a
personas SIN experiencia técnica. Explicas en español, con lenguaje simple, y
justificas decisiones de arquitectura y costos. Respetas el stack:
React + FastAPI + DynamoDB + AWS Lambda/API Gateway.

## Workflow: De la idea al MVP
1. **Entender**: aclara producto y usuarios.
2. **Diseñar**: propone arquitectura y, si ayuda, dibuja un diagrama.
3. **Modelar datos**: define el esquema del POS en DynamoDB (tabla única).
4. **Implementar**: guía el MVP (catálogo, venta, descuento de stock, reporte).

## Best Practices
- Primero el MVP; los extras después.
- Confirmaciones antes de acciones irreversibles (anular una venta).
- Nada de secretos en el código ni en el repo.
MD
ok "Creado: $POWER_MD"
show_file "$POWER_MD"
pause

# mcp.json — el power trae el MCP de diagramas
POWER_MCP="$POS_KIT/mcp.json"
exists_note "$POWER_MCP"
step "Creando ${POWER_MCP}…"
cat > "$POWER_MCP" <<'JSON'
{
  "mcpServers": {
    "drawio": {
      "url": "https://mcp.draw.io/mcp",
      "disabled": false,
      "autoApprove": ["create_diagram", "get_drawio_reference"],
      "headers": {
        "X-AI-Source": "kiro-pos-kit"
      }
    }
  }
}
JSON
ok "Creado: $POWER_MCP"
show_file "$POWER_MCP"

step "Validando el JSON del power…"
python3 -c "import json; json.load(open('$POWER_MCP')); print('JSON OK')" \
  && ok "mcp.json del power es válido." \
  || warn "mcp.json del power tiene un error."

pause

# --- Resultado ---------------------------------------------------------------
explain "Estructura del power que acabamos de crear:"
find "$POS_KIT" -type f | sed "s|$WORKSHOP_ROOT/||" | sort | sed 's/^/   /'

explain "Instalar / usar powers (CLI v3)" \
  "  /powers list                 → ver powers instalados" \
  "  /powers install <nombre>     → instalar del catálogo oficial" \
  "  /powers install ./ruta       → instalar uno LOCAL (como nuestro pos-kit)" \
  "  /powers uninstall <nombre>   → quitarlo" \
  "Kiro namespacea los MCP del power para evitar conflictos y los gestiona." \
  "Nuestro pos-kit se instalaría con:  /powers install .kiro/powers/pos-kit"

explain "Powers de terceros (catálogo oficial)" \
  "Hay powers listos de Stripe, Figma, Netlify, Supabase, Datadog, AWS Aurora," \
  "Strands SDK, Postman… Instalas uno y tu agente gana ese dominio al instante," \
  "sin configurar MCP ni steering a mano."

title "Acto 9 completado ✅"
explain "¡Y con esto cierra el recorrido scripteado del taller!" \
  "Ya tienes el equipo completo: reglas (steering), especialistas (agents)," \
  "un orquestador (sub-agents), conocimiento (skills), automatización (hooks)," \
  "herramientas externas (MCP), seguridad (permisos) y empaquetado (powers)." \
  "" \
  "➡  Último paso — EN VIVO (sin script): los Specs." \
  "   Pon a trabajar todo lo anterior para convertir la idea del POS en un" \
  "   plan ejecutable: requisitos → diseño → tareas. Lo hacemos juntos en el" \
  "   taller. Arranca con:  kiro-cli --v3 chat --agent tech-lead" \
  "   y pídele un spec del MVP del POS."
