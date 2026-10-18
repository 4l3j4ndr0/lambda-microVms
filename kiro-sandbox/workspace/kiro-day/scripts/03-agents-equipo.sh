#!/usr/bin/env bash
# =============================================================================
# ACTO 3 — "El equipo crece" (más Custom Agents)
# =============================================================================
# Historia: el arquitecto (Acto 2) ya nos propuso CÓMO construir el POS. Ahora
# necesitamos manos que lo implementen. Contratamos 3 especialistas más, y lo
# importante: cada uno con PERMISOS DISTINTOS según su rol.
#
# Feature de Kiro: Custom Agents (continuación). Aquí el foco es el CONTRASTE de
# permisos — el mismo mecanismo (tools / allowedTools) da desde un reviewer de
# solo lectura hasta un dev que escribe y ejecuta. Un equipo de agentes
# enfocados > un único chat genérico.
# =============================================================================

source "$(dirname "$0")/lib/common.sh"

title "ACTO 3 — El equipo crece: backend, frontend y reviewer"

story "Dónde vamos" \
  "El arquitecto diseñó la solución, pero no construye. Sumamos al equipo:" \
  "  • backend-dev  → implementa la API (FastAPI) y la lógica de ventas." \
  "  • frontend-dev → construye la UI del cajero (React)." \
  "  • reviewer     → revisa el código, SIN poder modificarlo."

explain "La idea clave de este acto: permisos por rol" \
  "Todos son el mismo Kiro, pero con 'tools' y 'allowedTools' distintos:" \
  "  - un dev necesita leer, escribir, ejecutar y buscar." \
  "  - un reviewer SOLO debe leer y analizar (jamás escribir)." \
  "Dar a cada agente solo lo que su rol necesita = seguridad y foco."

explain "El campo 'resources' y cómo exponer skills (bien hecho)" \
  "'resources' admite tres tipos por esquema de URI:" \
  "  file://   → se carga SIEMPRE al contexto al arrancar (lo que el agente" \
  "              siempre necesita)." \
  "  skill://  → carga solo name+description al inicio; el contenido completo" \
  "              se carga ON-DEMAND cuando el agente lo decide (contexto liviano)." \
  "  knowledgeBase → búsqueda sobre documentación indexada." \
  "Para SKILLS usa skill:// — nunca file://, o perderías la carga progresiva." \
  "El steering 'always' ya se inyecta solo: no hace falta declararlo aquí." \
  "A los devs les damos acceso a las skills (DynamoDB, Amplify) con skill://."

pause

AGENTS="$KIRO_DIR/agents"
mkdirp "$AGENTS"

# --- backend-dev -------------------------------------------------------------
explain "Especialista 1/3 — backend-dev (puede escribir y ejecutar)" \
  "Implementa la API del POS. Necesita el set completo: leer, escribir," \
  "ejecutar comandos (tests, servidor) y buscar en el código."

BE="$AGENTS/backend-dev.json"
exists_note "$BE"
step "Creando ${BE}…"
cat > "$BE" <<'JSON'
{
  "name": "backend-dev",
  "description": "Desarrolla la API del POS con FastAPI y la lógica de ventas/inventario.",
  "prompt": "Eres una desarrolladora backend senior en Python. Implementas la API del POS con FastAPI siguiendo el stack y las convenciones del steering del proyecto. Escribes código claro, con tipos, y tests para la lógica de negocio (ventas, descuento de stock). Explicas en español lo que haces, pero el código y los comentarios van en inglés. Antes de cambios grandes, describe tu plan.",
  "tools": ["fs_read", "fs_write", "execute_bash", "grep", "glob", "code"],
  "allowedTools": ["fs_read", "grep", "glob", "code"],
  "resources": [
    "skill://.kiro/skills/**/SKILL.md"
  ]
}
JSON
ok "Creado: $BE"
show_file "$BE"
pause

# --- frontend-dev ------------------------------------------------------------
explain "Especialista 2/3 — frontend-dev (UI para cajeros)" \
  "Construye la interfaz del cajero en React. Tiene acceso a las skills con" \
  "skill:// (p. ej. deploy-amplify para publicar). El steering de frontend" \
  "(fileMatch) se activa solo al editar .tsx/.jsx, sin declararlo aquí."

FE="$AGENTS/frontend-dev.json"
exists_note "$FE"
step "Creando ${FE}…"
cat > "$FE" <<'JSON'
{
  "name": "frontend-dev",
  "description": "Construye la UI del POS en React: catálogo, carrito de venta y cobro.",
  "prompt": "Eres un desarrollador frontend senior en React + TypeScript. Construyes una interfaz de punto de venta pensada para cajeros SIN formación técnica: botones grandes, textos claros en español, y confirmaciones antes de acciones irreversibles (como anular una venta). Sigues el stack y las convenciones del steering. Explicas en español; el código va en inglés.",
  "tools": ["fs_read", "fs_write", "execute_bash", "grep", "glob", "code"],
  "allowedTools": ["fs_read", "grep", "glob", "code"],
  "resources": [
    "skill://.kiro/skills/**/SKILL.md"
  ]
}
JSON
ok "Creado: $FE"
show_file "$FE"
pause

# --- reviewer (read-only) ----------------------------------------------------
explain "Especialista 3/3 — reviewer (SOLO lectura)" \
  "Revisa calidad, seguridad y tests. El contraste importante: sus 'tools'" \
  "NO incluyen fs_write ni execute_bash. No puede modificar nada, por diseño." \
  "No necesita skills ni resources: solo lee, analiza y recomienda."

RV="$AGENTS/reviewer.json"
exists_note "$RV"
step "Creando ${RV}…"
cat > "$RV" <<'JSON'
{
  "name": "reviewer",
  "description": "Revisión de código de solo lectura: seguridad, manejo de errores y cobertura de tests.",
  "prompt": "Eres un revisor de código senior. Analizas en busca de vulnerabilidades de seguridad, mal manejo de errores y falta de tests. NO modificas código: señalas problemas, explicas el riesgo y propones el cambio, pero la decisión y la edición las hace un dev. Priorizas por severidad. Respondes en español.",
  "tools": ["fs_read", "grep", "glob", "code"],
  "allowedTools": ["fs_read", "grep", "glob", "code"]
}
JSON
ok "Creado: $RV"
show_file "$RV"
pause

# --- Validación de todos los agentes ----------------------------------------
step "Validando el JSON de TODOS los agentes del equipo…"
all_ok=1
for f in "$AGENTS"/*.json; do
  if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$f" 2>/dev/null; then
    ok "válido: $(basename "$f")"
  else
    warn "INVÁLIDO: $(basename "$f") — Kiro no lo cargaría"
    all_ok=0
  fi
done
[ "$all_ok" = "1" ] && ok "Todo el equipo tiene configs válidas."

# --- Tabla comparativa de permisos ------------------------------------------
explain "El equipo contratado y sus permisos:"
printf "   %-14s | %-6s | %-8s | %-8s | %-8s\n" "AGENTE" "leer" "escribir" "ejecutar" "revisa"
printf "   %-14s-+-%-6s-+-%-8s-+-%-8s-+-%-8s\n" "--------------" "------" "--------" "--------" "--------"
printf "   %-14s | %-6s | %-8s | %-8s | %-8s\n" "arquitecto"   "SI" "no" "no" "disena"
printf "   %-14s | %-6s | %-8s | %-8s | %-8s\n" "backend-dev"  "SI" "SI" "SI" "no"
printf "   %-14s | %-6s | %-8s | %-8s | %-8s\n" "frontend-dev" "SI" "SI" "SI" "no"
printf "   %-14s | %-6s | %-8s | %-8s | %-8s\n" "reviewer"     "SI" "NO" "NO" "SI"

explain "Cómo trabajar con el equipo" \
  "  /agent list                 → ver a todos los especialistas" \
  "  /agent swap backend-dev     → ponte a implementar la API" \
  "  /agent swap reviewer        → pide una revisión (no tocará tu código)" \
  "Un flujo típico: arquitecto diseña → backend/frontend implementan →" \
  "reviewer audita. Cambias de 'sombrero' con /agent swap."

title "Acto 3 completado ✅"
explain "Tenemos un equipo completo. Pero a veces un dev necesita conocimiento" \
  "experto puntual (p. ej. cómo modelar ventas en DynamoDB) sin cargarlo" \
  "siempre. Para eso están las Skills." \
  "" \
  "➡  Siguiente: ./scripts/04-skills.sh (conocimiento experto bajo demanda)"
