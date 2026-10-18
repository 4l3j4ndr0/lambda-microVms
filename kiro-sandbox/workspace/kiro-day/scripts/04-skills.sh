#!/usr/bin/env bash
# =============================================================================
# ACTO 4 — "Conocimiento experto bajo demanda" (Skills)
# =============================================================================
# Historia: el equipo (Actos 2-3) sabe construir, pero hay conocimiento de
# dominio muy puntual que no queremos cargar en TODAS las conversaciones: cómo
# modelar los datos del POS en DynamoDB, o cómo desplegar con Amplify. Eso lo
# empaquetamos como SKILLS: manuales que Kiro carga solo cuando hacen falta.
#
# Feature de Kiro: SKILLS — carpetas con un SKILL.md (frontmatter name +
# description) en .kiro/skills/. Kiro lee SOLO el name+description al arrancar
# (costo de contexto mínimo); carga el contenido completo cuando tu pregunta
# coincide con la description, o cuando la invocas con "/" en el chat.
# =============================================================================

source "$(dirname "$0")/lib/common.sh"

title "ACTO 4 — Conocimiento experto bajo demanda (Skills)"

story "Dónde vamos" \
  "Dos problemas concretos del POS necesitan conocimiento especializado:" \
  "  1) ¿Cómo modelamos productos y ventas en DynamoDB? (diseño de datos)" \
  "  2) ¿Cómo publicamos el POS en internet? (despliegue con Amplify)" \
  "No queremos ese detalle en cada charla: lo empacamos como skills."

explain "¿Qué es una Skill?" \
  "Un paquete de conocimiento portátil. Kiro lee SOLO el nombre y la" \
  "descripción al arrancar (contexto barato). Cuando tu pregunta coincide" \
  "con la descripción, carga el contenido completo. También la invocas a" \
  "mano escribiendo '/' en el chat."

explain "Skill vs Steering — ¿cuál es la diferencia?" \
  "  Steering  → reglas del proyecto, SIEMPRE o por archivo (always/fileMatch)." \
  "  Skill     → conocimiento que se activa SOLO cuando la conversación lo pide." \
  "Regla práctica: si aplica siempre, es steering; si es experticia puntual," \
  "es skill. Las descripciones ESPECÍFICAS activan mejor que las genéricas."

pause

SKILLS="$KIRO_DIR/skills"
mkdirp "$SKILLS"

# --- Skill 1: modelado DynamoDB ---------------------------------------------
explain "Skill 1/2 — modelado en DynamoDB" \
  "Carpeta: .kiro/skills/dynamodb-pos/  con su SKILL.md." \
  "Descripción específica: 'modelar productos, ventas e inventario del POS" \
  "en DynamoDB (tabla única)'. Así Kiro la activa cuando toque datos."

DDB_DIR="$SKILLS/dynamodb-pos"
mkdirp "$DDB_DIR"
DDB="$DDB_DIR/SKILL.md"
exists_note "$DDB"
step "Creando ${DDB}…"
cat > "$DDB" <<'MD'
---
name: dynamodb-pos
description: Modela los datos del POS (productos, ventas, inventario) en Amazon DynamoDB con diseño de tabla única. Úsala al diseñar el esquema de datos, claves de partición/orden, o patrones de acceso del POS.
---

# Modelado del POS en DynamoDB (tabla única)

## Patrones de acceso (primero esto, SIEMPRE)
1. Obtener un producto por SKU.
2. Listar todos los productos (catálogo).
3. Registrar una venta con varios ítems.
4. Listar las ventas de un día.

## Diseño de tabla única
Una sola tabla `pos` con claves genéricas `PK` y `SK`.

| Entidad   | PK                | SK                      | Atributos                         |
|-----------|-------------------|-------------------------|-----------------------------------|
| Producto  | `PRODUCT#<sku>`   | `PRODUCT#<sku>`         | name, price, stock                |
| Venta     | `SALE#<date>`     | `SALE#<ts>#<saleId>`    | total, paymentMethod, items[]     |

## Reglas
- Descontar `stock` del producto en la misma operación de venta (transacción).
- Fechas en ISO-8601 UTC para ordenar ventas por `SK`.
- No normalizar en exceso: en DynamoDB se modela por patrón de acceso, no por
  relaciones.

## Antipatrones a evitar
- Scan para listar el catálogo si crece mucho (preferir Query por prefijo).
- Guardar el total como string (usar número para poder sumar en reportes).
MD
ok "Creado: $DDB"
show_file "$DDB"
pause

# --- Skill 2: despliegue con Amplify ----------------------------------------
explain "Skill 2/2 — despliegue con AWS Amplify" \
  "Carpeta: .kiro/skills/deploy-amplify/  con su SKILL.md." \
  "Conocimiento de cómo publicar el frontend (React) y conectar el backend." \
  "Se activa cuando preguntes por 'desplegar', 'publicar' o 'hosting'."

AMP_DIR="$SKILLS/deploy-amplify"
mkdirp "$AMP_DIR"
AMP="$AMP_DIR/SKILL.md"
exists_note "$AMP"
step "Creando ${AMP}…"
cat > "$AMP" <<'MD'
---
name: deploy-amplify
description: Despliega el POS con AWS Amplify — hosting del frontend React, backend (API/datos) y CI/CD desde el repo. Úsala al publicar, desplegar o configurar hosting del POS.
---

# Desplegar el POS con AWS Amplify

## Cuándo usar Amplify
Para publicar rápido una app full-stack (frontend + backend + auth + datos) con
CI/CD conectado al repositorio, sin gestionar servidores.

## Flujo de despliegue del frontend (React + Vite)
1. `npm create vite@latest` ya debe existir (lo crea frontend-dev).
2. Conectar el repo en Amplify Hosting (build automático en cada push).
3. Build settings típicos para Vite:
   - build command: `npm run build`
   - output directory: `dist`

## Backend (datos + API)
- Con Amplify Gen 2 (TypeScript, code-first) se definen datos (DynamoDB vía
  AppSync) y funciones. Encaja con el stack del POS.
- Alternativa: mantener FastAPI en Lambda + API Gateway y usar Amplify solo
  para el hosting del frontend. Decidir con el arquitecto según complejidad.

## Checklist antes de publicar
- Variables de entorno y endpoints del backend configurados en Amplify.
- Dominio: usar el de Amplify al inicio; dominio propio después.
- Revisar costos: hosting + requests + almacenamiento de datos.

## Nota
Este proyecto tiene un skill/power de Amplify Gen2 más completo disponible en el
entorno; esta skill es la guía de arranque específica del POS.
MD
ok "Creado: $AMP"
show_file "$AMP"
pause

# --- Resultado ---------------------------------------------------------------
explain "Skills creadas en .kiro/skills/:"
find "$SKILLS" -name SKILL.md | sed "s|$WORKSHOP_ROOT/||" | sort | sed 's/^/   /'

explain "Cómo se activan" \
  "Automática: pregunta en el chat algo como" \
  "  'Diseña el esquema de datos del POS'      → activa dynamodb-pos" \
  "  'Quiero publicar el POS en internet'       → activa deploy-amplify" \
  "Manual: escribe '/' en el chat y elige la skill por su nombre." \
  "Kiro solo pagó el costo de name+description hasta que la necesitaste."

title "Acto 4 completado ✅"
explain "El equipo ya tiene reglas, especialistas y manuales expertos. Ahora" \
  "automaticemos el proceso: que ciertas acciones se disparen solas (tests," \
  "validaciones) sin pedírselo. Eso son los Hooks." \
  "" \
  "➡  Siguiente: ./scripts/05-hooks.sh (automatización por eventos)"
