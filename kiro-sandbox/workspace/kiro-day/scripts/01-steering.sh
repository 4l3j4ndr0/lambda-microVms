#!/usr/bin/env bash
# =============================================================================
# ACTO 1 — "Las reglas de la casa" (Steering)
# =============================================================================
# Historia: tenemos la oficina montada (Acto 0). Antes de contratar
# especialistas, definimos CÓMO trabaja el equipo: qué construimos, con qué
# stack, con qué convenciones y en qué idioma. Si no lo fijamos, tendríamos que
# repetírselo a cada agente en cada conversación.
#
# Feature de Kiro: STEERING — archivos markdown en .kiro/steering/ que Kiro lee
# como contexto persistente. Soportan 4 modos de inclusión:
#   always     → se carga en TODA sesión (reglas universales del proyecto)
#   fileMatch  → se carga solo al tocar archivos que matchean un patrón
#   manual     → se carga a pedido, referenciándolo con #nombre
#   auto       → Kiro decide cargarlo según su 'description'
# =============================================================================

source "$(dirname "$0")/lib/common.sh"

title "ACTO 1 — Las reglas de la casa (Steering)"

story "Dónde vamos" \
  "La oficina (.kiro/) está lista, pero vacía." \
  "Si contratamos un arquitecto y 3 devs sin reglas comunes, cada uno" \
  "asumiría un stack distinto. Primero fijamos las reglas de la casa."

explain "¿Qué es Steering?" \
  "Archivos markdown en .kiro/steering/ que Kiro lee como conocimiento" \
  "PERSISTENTE del proyecto. Sin steering, repetirías en cada sesión:" \
  "'usamos React', 'responde en español', 'no uses var'…" \
  "Con steering, lo escribes UNA vez y todos los agentes lo respetan."

explain "Los 4 modos de inclusión (frontmatter 'inclusion')" \
  "  always     → en TODA sesión. Para reglas universales del proyecto." \
  "  fileMatch  → solo al editar archivos que matchean un patrón (p. ej. *.tsx)." \
  "  manual     → a pedido, lo invocas con #nombre en el chat." \
  "  auto       → Kiro decide cargarlo según su 'description'." \
  "Objetivo: mantener el contexto LIGERO — no cargar todo siempre."

pause

STEERING="$KIRO_DIR/steering"
mkdirp "$STEERING"

# --- 1) producto.md — la visión del POS (inclusion: always) ------------------
explain "Archivo 1/3 — producto.md (inclusion: always)" \
  "La visión del negocio. Va 'always' porque TODO agente, haga lo que haga," \
  "debe entender qué estamos construyendo y para quién."

PRODUCTO="$STEERING/producto.md"
exists_note "$PRODUCTO"
step "Creando ${PRODUCTO}…"
cat > "$PRODUCTO" <<'MD'
---
inclusion: always
---

# Producto: POS para tienda de barrio

## Qué estamos construyendo
Un sistema de punto de venta (POS) simple para tiendas pequeñas / cafeterías.

## Usuarios
- **Cajero/a**: registra ventas, cobra, imprime o muestra el recibo.
- **Dueño/a**: ve reportes de ventas e inventario.

## Funcionalidades núcleo (MVP)
1. Catálogo de productos (nombre, precio, SKU, stock).
2. Registrar una venta (varios ítems, total, método de pago).
3. Descontar stock al vender.
4. Reporte de ventas del día.

## Principios
- Simple antes que completo: primero el MVP, luego extras.
- Pensado para gente SIN conocimientos técnicos operándolo.
- Español como idioma del producto y de la comunicación del equipo.
MD
ok "Creado: $PRODUCTO"
show_file "$PRODUCTO"
pause

# --- 2) tech.md — el stack (inclusion: always) -------------------------------
explain "Archivo 2/3 — tech.md (inclusion: always)" \
  "El stack tecnológico. También 'always': fija de entrada las decisiones" \
  "para que ningún agente proponga algo fuera del stack acordado."

TECH="$STEERING/tech.md"
exists_note "$TECH"
step "Creando ${TECH}…"
cat > "$TECH" <<'MD'
---
inclusion: always
---

# Stack tecnológico

- **Frontend**: React + Vite + TypeScript.
- **Backend**: Python 3.12 + FastAPI.
- **Datos**: Amazon DynamoDB (tabla única, diseño simple).
- **Despliegue**: AWS serverless — AWS Lambda + API Gateway.
- **Infra como código**: AWS SAM o CDK (a decidir con el arquitecto).

## Convenciones
- Código y comentarios en inglés; comunicación con el usuario en español.
- Nombres descriptivos; funciones pequeñas y con una sola responsabilidad.
- Tests para la lógica de negocio (ventas, inventario).
- Nada de secretos en el código ni en el repo.
MD
ok "Creado: $TECH"
show_file "$TECH"
pause

# --- 3) frontend.md — reglas específicas (inclusion: fileMatch) --------------
explain "Archivo 3/3 — frontend.md (inclusion: fileMatch)" \
  "Reglas que SOLO importan al tocar código de frontend. Usamos 'fileMatch'" \
  "con patrones: este steering se carga únicamente cuando se editan .tsx/.jsx." \
  "Así no gastamos contexto con reglas de UI cuando trabajamos en el backend."

FRONTEND="$STEERING/frontend.md"
exists_note "$FRONTEND"
step "Creando ${FRONTEND}…"
cat > "$FRONTEND" <<'MD'
---
inclusion: fileMatch
fileMatchPattern: "**/*.{tsx,jsx,css}"
---

# Reglas de Frontend (POS)

- Componentes funcionales con hooks; nada de componentes de clase.
- La UI debe ser usable por cajeros sin formación técnica: botones grandes,
  textos claros en español, confirmaciones antes de acciones irreversibles.
- Accesibilidad: roles ARIA y foco de teclado en formularios de cobro.
- Estado del carrito de venta centralizado (un solo lugar de verdad).
MD
ok "Creado: $FRONTEND"
show_file "$FRONTEND"
pause

# --- Resultado ---------------------------------------------------------------
explain "Esto es lo que acabamos de crear en .kiro/steering/:"
find "$STEERING" -type f | sed "s|$WORKSHOP_ROOT/||" | sort | sed 's/^/   /'

explain "Cómo probarlo en el chat" \
  "Abre:  kiro-cli --v3 chat" \
  "Pregunta algo como:  'Según nuestro proyecto, ¿qué stack usamos y en qué" \
  "idioma respondes?'  → debería responder en español y citar React/FastAPI/" \
  "DynamoDB SIN que se lo digas: lo leyó del steering 'always'." \
  "" \
  "El steering 'manual' se invoca escribiendo #nombre en el chat." \
  "El 'fileMatch' se activa solo cuando edites un .tsx/.jsx."

title "Acto 1 completado ✅"
explain "Ya tenemos las reglas de la casa. El equipo sabe qué construir, con" \
  "qué stack y cómo comunicarse. Ahora sí: contratemos al primer especialista." \
  "" \
  "➡  Siguiente: ./scripts/02-agents.sh (contratamos al arquitecto)"
