<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/kiro/default.svg" alt="Kiro" width="72" height="72" />
</p>

<h1 align="center">Kiro Day Medellín 2026</h1>

<p align="center"><strong>Workshop: construye tu equipo de agentes con Kiro CLI</strong></p>

---

Este es tu workspace **kiro-day**: un VS Code completo en el navegador con
**Kiro CLI** preinstalado. No necesitas instalar nada en tu equipo.

## 🎬 El caso de uso que seguiremos

Tenemos una **idea de negocio**: un sistema **POS** (punto de venta) para una
tienda. Pero **no sabemos de desarrollo ni de cloud**.

En vez de rendirnos (o contratar un equipo caro), vamos a usar **Kiro** para
armar nuestro propio **equipo de especialistas** — agentes que nos acompañan
desde la idea hasta el despliegue.

A lo largo del taller, cada paso "contrata" o configura una pieza del equipo, y
al hacerlo vamos descubriendo **todas las features de Kiro**:

| Feature de Kiro | En la historia es… | Acto |
|-----------------|--------------------|------|
| Estructura `.kiro/` + Settings | Montar la oficina | 0 |
| **Steering** | Las reglas de la casa (estándares del equipo) | 1 |
| **Custom Agents** | Los especialistas (arquitecto, backend, frontend…) | 2–3 |
| **Skills** | Manuales de conocimiento experto bajo demanda | 4 |
| **Hooks** | Automatización por eventos (nuestro QA) | 5 |
| **MCP** | Conectar herramientas externas (dibujar diagramas con draw.io) | 6 |
| **Permisos / Seguridad** | Qué puede y qué NO puede hacer el equipo | 7 |
| **Powers** | Empaquetar y compartir el equipo (o instalar el de otros) | 8 |
| **Specs** | De la idea a un plan: requisitos → diseño → tareas | 9 · 🔴 en vivo |

> El POS es la excusa narrativa. El objetivo real es que al final tengas creado
> y entendido **todo el arsenal de configuración de Kiro**.

---

## 🚀 Primeros pasos (una sola vez)

**1. Abre una terminal** (`Ctrl+ñ` / `Cmd+ñ`) — ya se abre una al entrar.

**2. Inicia sesión en Kiro CLI** (device flow — abre la URL en tu laptop):

```bash
kiro-cli login --use-device-flow
```

**3. Comprueba que el agente responde:**

```bash
kiro-cli --v3 chat
```

> El login usa **device-code flow**: se imprime una URL + código que abres en el
> navegador de tu laptop para autorizar. No necesitas navegador dentro del sandbox.
>
> 💡 Usamos `--v3` para las sesiones interactivas (agent engine v3).

---

## 🧭 Cómo funciona el taller

Los pasos viven en la carpeta [`scripts/`](scripts/). **Cada script crea
recursos reales de Kiro y, al ejecutarse, explica qué hace y por qué.** La idea
es ejecutarlos en orden, leyendo la salida y experimentando entre paso y paso.

```bash
# dar permisos de ejecución la primera vez
chmod +x scripts/*.sh

# ejecutar un acto
./scripts/00-setup-kiro.sh
```

> 💡 Los scripts hacen **pausas** (Enter) para dar tiempo a explicar. Si quieres
> que corran de corrido, antepón `WORKSHOP_NOWAIT=1`:
> ```bash
> WORKSHOP_NOWAIT=1 ./scripts/00-setup-kiro.sh
> ```

---

## Acto 0 — Llegó la idea: montamos la oficina

```bash
./scripts/00-setup-kiro.sh
```

**Qué enseña:** la estructura de configuración de Kiro — la carpeta `.kiro/` — y
el concepto de **scopes** (proyecto vs global).

**Qué crea:**

```
.kiro/
├── steering/          # reglas de la casa (Acto 1)
├── agents/            # los especialistas (Actos 2–3)
├── skills/            # conocimiento bajo demanda (Acto 4)
├── hooks/             # automatización por eventos (Acto 5)
├── settings/
│   └── mcp.json       # conexión a herramientas externas (Acto 6)
├── specs/             # features estructuradas (Acto 7)
└── README.md          # mapa de la oficina
```

**Conceptos clave:**

- Todo lo que personaliza a Kiro para un proyecto vive en `.kiro/` en la raíz.
- **Scope de proyecto** (`.kiro/`): aplica solo a este proyecto. Es lo que usamos hoy.
- **Scope global** (`~/.kiro/`): aplicaría a todos tus proyectos.
- `settings/mcp.json` queda creado pero vacío; le daremos vida en el Acto 6.

<!-- ACTOS-SIGUIENTES: a medida que avancemos, cada acto se documenta aquí. -->

## Acto 1 — Las reglas de la casa (Steering)

```bash
./scripts/01-steering.sh
```

**Qué enseña:** **Steering** — archivos markdown en `.kiro/steering/` que Kiro
lee como contexto **persistente** del proyecto, y sus **4 modos de inclusión**.

**Qué crea:**

```
.kiro/steering/
├── producto.md    # inclusion: always     → la visión del POS (toda sesión)
├── tech.md        # inclusion: always     → el stack tecnológico
└── frontend.md    # inclusion: fileMatch  → reglas solo al editar *.tsx/*.jsx
```

**Los 4 modos de inclusión** (en el frontmatter `inclusion:`):

| Modo | Cuándo se carga | Úsalo para |
|------|-----------------|------------|
| `always` | En toda sesión | Reglas universales del proyecto |
| `fileMatch` | Al editar archivos que matchean un patrón | Reglas específicas de un área (UI, tests…) |
| `manual` | A pedido, lo invocas con `#nombre` en el chat | Contexto pesado que no siempre hace falta |
| `auto` | Kiro decide según la `description` del archivo | Reglas que aplican "a veces" |

> La meta es mantener el **contexto ligero**: no cargar todo siempre.

**Pruébalo:** abre `kiro-cli --v3 chat` y pregunta *"¿Qué stack usamos y en qué idioma
respondes?"*. Debería responder en español y citar React/FastAPI/DynamoDB **sin
que se lo digas** — lo leyó del steering `always`.

## Acto 2 — Contratamos al primer especialista (Agents)

```bash
./scripts/02-agents.sh
```

**Qué enseña:** **Custom Agents** — configuraciones JSON en `.kiro/agents/` que
convierten a Kiro en un especialista con un rol fijo.

**Qué crea:** `.kiro/agents/arquitecto.json` — un arquitecto de soluciones AWS
de **solo lectura** (propone y explica, no escribe código).

**Campos de un agente:**

| Campo | Qué hace |
|-------|----------|
| `name` | Identificador. Lo invocas con `kiro-cli --v3 chat --agent arquitecto` |
| `description` | Una línea de para qué sirve |
| `prompt` | Su rol / instrucciones de sistema (lo que lo enfoca) |
| `tools` | Qué herramientas **puede** usar |
| `allowedTools` | Cuáles se **auto-aprueban** (sin pedir confirmación) |
| `resources` | Recursos locales: `file://` (carga siempre), `skill://` (on-demand), knowledge bases |

> **Seguridad por diseño:** al arquitecto le damos solo `fs_read`, `grep`,
> `glob` y `code` — puede leer y analizar, pero no ejecutar comandos ni
> escribir. Cada especialista recibe únicamente las herramientas que su rol
> necesita.
>
> **Sobre `resources`:** admite `file://` (se carga al contexto **siempre**),
> `skill://` (carga solo metadata y el contenido **on-demand**) y knowledge
> bases. El steering `always` ya se inyecta solo, así que **no** se declara en el
> agente; por eso el arquitecto va sin `resources`.

**Pruébalo:**

```bash
kiro-cli --v3 chat --agent arquitecto
# luego, dentro del chat:
#   Propón la arquitectura del POS y explícamela como si no supiera de cloud.
```

Comandos útiles dentro del chat: `/agent list` (ver agentes), `/agent swap
arquitecto` (cambiar en caliente). El arquitecto ya conoce el producto y el
stack porque los precargamos en `resources`.

## Acto 3 — El equipo crece (más Agents)

```bash
./scripts/03-agents-equipo.sh
```

**Qué enseña:** el mismo mecanismo de agentes, pero con el foco en el
**contraste de permisos** — `tools` y `allowedTools` definen qué puede hacer
cada rol, desde un reviewer de solo lectura hasta un dev que escribe y ejecuta.

**Qué crea:** tres agentes más en `.kiro/agents/`.

| Agente | leer | escribir | ejecutar | Rol |
|--------|:----:|:--------:|:--------:|-----|
| `arquitecto` | ✅ | ❌ | ❌ | Diseña y explica (Acto 2) |
| `backend-dev` | ✅ | ✅ | ✅ | Implementa la API (FastAPI) |
| `frontend-dev` | ✅ | ✅ | ✅ | Construye la UI (React) |
| `reviewer` | ✅ | ❌ | ❌ | Audita; no modifica, por diseño |

> El `reviewer` no tiene `fs_write` ni `execute_bash` en sus `tools`: aunque le
> pidas "arréglalo", no tiene con qué. **Los permisos son el límite real.**

**Flujo típico del equipo:** `arquitecto` diseña → `backend-dev` / `frontend-dev`
implementan → `reviewer` audita. Cambias de "sombrero" con `/agent swap <name>`.

> Nota: `frontend-dev` no precarga el steering de frontend — ese es `fileMatch`
> y se activa solo al editar `.tsx`/`.jsx`. Los devs sí exponen las skills con
> `skill://.kiro/skills/**/SKILL.md` (carga on-demand); el `reviewer` no las
> necesita, así que va sin `resources`.

## Acto 4 — Conocimiento experto bajo demanda (Skills)

```bash
./scripts/04-skills.sh
```

**Qué enseña:** **Skills** — paquetes de conocimiento en `.kiro/skills/` que Kiro
carga **solo cuando tu pregunta coincide** con su descripción (o al invocarlas
con `/`). Costo de contexto mínimo: al arrancar solo lee `name` + `description`.

**Qué crea:** dos skills, cada una en su carpeta con un `SKILL.md`.

```
.kiro/skills/
├── dynamodb-pos/
│   └── SKILL.md    # modelar productos/ventas/inventario en DynamoDB
└── deploy-amplify/
    └── SKILL.md    # publicar el POS con AWS Amplify (hosting + backend)
```

**Formato (frontmatter YAML):**

```markdown
---
name: dynamodb-pos
description: Modela los datos del POS en DynamoDB... Úsala al diseñar el esquema.
---
# contenido del manual…
```

**Skill vs Steering:**

| | Cuándo se carga | Úsalo para |
|-|-----------------|------------|
| **Steering** | Siempre o por archivo (`always`/`fileMatch`) | Reglas del proyecto |
| **Skill** | Solo cuando la conversación lo pide | Experticia puntual |

> Las descripciones **específicas** activan mejor: *"Design DynamoDB single-table
> schemas"* funciona mejor que *"Help with databases"*.

**Pruébalo:** en `kiro-cli --v3 chat`, pide *"Diseña el esquema de datos del POS"*
(activa `dynamodb-pos`) o *"Quiero publicar el POS en internet"* (activa
`deploy-amplify`). También puedes escribir `/` y elegir la skill por su nombre.

## Acto 5 — Automatización del equipo (Hooks)

```bash
./scripts/05-hooks.sh
```

**Qué enseña:** **Hooks** — comandos (o prompts) que Kiro ejecuta
**automáticamente** en puntos del ciclo de vida del agente. Archivos
`.kiro/hooks/<id>.json` con el schema CLI v3.

**Qué crea:** dos hooks.

```
.kiro/hooks/
├── qa-tests.json      # PostToolUse  → corre los tests al escribir código
└── guard-shell.json   # PreToolUse   → BLOQUEA comandos de shell peligrosos
```

**Formato (un archivo puede definir varios hooks):**

```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "guard-dangerous-shell",
      "trigger": "PreToolUse",
      "matcher": "execute_bash",
      "action": { "type": "command", "command": "..." }
    }
  ]
}
```

**Eventos (trigger) más usados:**

| Trigger | Cuándo corre | Nota |
|---------|--------------|------|
| `AgentSpawn` | Al iniciar el agente | Inyectar contexto |
| `UserPromptSubmit` | Al enviar tú un prompt | Puede bloquearlo (exit 2) |
| `PreToolUse` | **Antes** de usar una tool | Puede **bloquear** (exit 2, fail-closed) |
| `PostToolUse` | **Después** de usar una tool | Validar / testear |
| `Stop` | Al terminar el turno | Post-proceso |

- `action.type`: `command` (shell, recibe el evento por STDIN) o `agent` (prompt).
- `matcher`: a qué tool aplica — `fs_write`/`write`, `execute_bash`/`shell`, `@git`, `*`…

> ⚠ **`PreToolUse` es fail-closed:** si el hook falla, cuelga o no se puede
> ejecutar, el tool se **bloquea** igual. Protege, pero un bug en el guardia
> bloquearía todos los `execute_bash`. Pruébalo antes de confiar en él.

**Pruébalo:** en `kiro-cli --v3 chat`, pide a `backend-dev` crear un archivo (dispara
el QA al escribir) o ejecutar `rm -rf /` (el guardia lo bloquea antes de correr).

## Acto 6 — Herramientas externas (MCP)

```bash
./scripts/06-mcp.sh
```

**Qué enseña:** **MCP (Model Context Protocol)** — conecta Kiro a servidores
externos que exponen herramientas. Config en `.kiro/settings/mcp.json` (el que
creamos vacío en el Acto 0).

**Qué hace:** conecta el **MCP de draw.io** para que el equipo pueda **dibujar
diagramas** (arquitectura, flujo de venta, modelo de datos) en vez de solo
describirlos.

```json
{
  "mcpServers": {
    "drawio": {
      "url": "https://mcp.draw.io/mcp",
      "disabled": false,
      "autoApprove": ["create_diagram", "get_drawio_reference"]
    }
  }
}
```

**Dos tipos de server MCP:**

| Tipo | Campos | Ejemplo |
|------|--------|---------|
| **Local** | `command`, `args`, `env` | Kiro lanza un proceso |
| **Remoto** | `url`, `headers` (Streamable HTTP) | draw.io — **sin instalar nada** |

draw.io es **remoto**: basta la URL, ideal para el sandbox. Aporta
`create_diagram` (genera diagramas desde draw.io XML o Mermaid) y
`get_drawio_reference`.

**Pruébalo:** entra a `kiro-cli --v3 chat`, verifica con `/mcp list`, y pide al
`arquitecto`: *"Dibuja la arquitectura del POS: React → API Gateway → Lambda
(FastAPI) → DynamoDB, en Mermaid."* En una terminal, draw.io devuelve un enlace
que abre el diagrama.

> `autoApprove` solo para herramientas seguras: `create_diagram` solo genera
> diagramas, no toca tu sistema.

## Acto 7 — Seguridad: permisos del equipo

```bash
./scripts/07-permisos.sh
```

**Qué enseña:** el modelo de **permisos** de Kiro — control **declarativo y por
capacidad** de lo que el agente puede hacer. Y cómo aplicarlo **a nivel de
agente** (versionable, viaja con el repo), que es la forma práctica de
entregarlo con el proyecto.

**Qué crea:** `deploy-ops.json` — un agente "operador de despliegue" que **solo
puede desplegar** (git/npm/aws), con lo destructivo y los secretos **bloqueados**
por sus propios permisos. Más un `permissions.yaml` de ejemplo en
`.kiro/security/` (referencia del scope global).

**Permisos a nivel de agente** (dentro del `.json`):

```json
"toolsSettings": {
  "shell": { "allowedCommands": ["git .*", "npm .*", "aws .*"], "autoAllowReadonly": true }
},
"permissions": {
  "rules": [
    { "capability": "fs_read", "match": ["**/.env", "**/*.pem", "secrets/**"], "effect": "deny" },
    { "capability": "shell",   "match": ["rm -rf *", "sudo *"], "effect": "deny" },
    { "capability": "shell",   "match": ["git *", "npm *", "aws *"], "effect": "allow" },
    { "capability": "fs_read", "effect": "allow" }
  ],
  "policies": ["read-only-shell"]
}
```

**Capability-based:** reglas por capacidad — `fs_read`, `fs_write`, `shell`,
`web_fetch`, `mcp`, `subagent`, `skill`… Cada regla = capacidad + `match` + efecto.

**Tres efectos, con precedencia estricta:**

| Efecto | Qué hace |
|--------|----------|
| `deny` | Bloquea **siempre** (ni pregunta) |
| `ask` | Pregunta antes de proceder |
| `allow` | Procede en silencio |

> **`deny > ask > allow`**: un `deny` gana en **cualquier** scope. Por eso, aunque
> `deploy-ops` tenga `allow` de `aws *`, un `rm -rf` sigue **bloqueado**.

**`policies`:** presets de permisos reutilizables con nombre —
`read-only-shell`, `read-workspace`, `edit-workspace`, `dev-shell`, `allow-all`.
Se combinan para armar el perfil de la sesión sin escribir cada regla.

**Dos lugares para definir permisos:**

| Dónde | Ubicación | Se versiona |
|-------|-----------|:-----------:|
| **Agente** | campo `permissions` en `.kiro/agents/*.json` | ✅ (con el repo) |
| Usuario | `~/.kiro/settings/permissions.yaml` | ❌ (fuera del repo) |
| Workspace | `~/.kiro/workspace-roots/<hash>/permissions.yaml` | ❌ (fuera del repo) |

> 🔒 **Workspace trust:** un repo clonado es **no confiable** hasta que tú lo
> confías; Kiro no carga sus agents/steering/MCP/skills y pregunta antes de cada
> comando. La decisión se guarda **fuera** del repo: un repositorio **no puede**
> auto-confiarse. **Invariantes** hardcoded: el agente nunca escribe sus propios
> settings (no se auto-eleva) y siempre pregunta antes de tocar `.git/**`.

**Pruébalo:** `kiro-cli --v3 chat --agent deploy-ops`, pídele desplegar (corre
git/npm/aws) y luego pídele `rm -rf /` — lo tiene denegado por sus permisos. En
vivo: `/tools` y `/tools trust-all`. En headless/CI, cada `ask` equivale a `deny`.

## Acto 8 — Empaquetar y compartir el equipo (Powers)

```bash
./scripts/08-powers.sh
```

**Qué enseña:** **Powers** — bundles instalables que empaquetan
documentación/steering + workflows + (opcional) servers MCP en una unidad que
Kiro activa **por keywords**. Son la unidad de **distribución** de capacidades.

**Qué crea:** un power propio, `pos-kit`, en `.kiro/powers/`.

```
.kiro/powers/pos-kit/
├── POWER.md     # frontmatter + onboarding + steering + workflows
└── mcp.json     # los MCP que trae el power (aquí, draw.io)
```

**`POWER.md` (frontmatter + secciones):**

```markdown
---
name: "pos-kit"
displayName: "POS Starter Kit"
description: "Equipo y buenas prácticas para construir un POS en AWS serverless"
keywords: ["pos", "ventas", "inventario", "dynamodb"]
---
# Onboarding …
# Steering Instructions …
## Workflow: De la idea al MVP …
## Best Practices …
```

**Power vs Skill vs MCP:**

| | Qué es |
|-|--------|
| **Skill** | Conocimiento (texto) on-demand |
| **MCP** | Herramientas externas (tools) |
| **Power** | **Empaqueta** skills + MCP + workflows en algo instalable y compartible |

> **Por qué importan:** conectar 5 MCP sueltos puede cargar 100+ definiciones de
> tools y consumir ~40% del contexto antes del primer prompt. Los powers cargan
> solo lo relevante según la conversación.

**Comandos (CLI v3):**

```bash
/powers list                        # powers instalados
/powers install <nombre>            # del catálogo oficial (Stripe, Figma, AWS…)
/powers install .kiro/powers/pos-kit   # uno local, como el nuestro
/powers uninstall <nombre>
```

## Acto 9 — De la idea al plan (Specs) · 🔴 en vivo

> Este acto **no tiene script**: se hace en directo. Specs es el flujo
> estructurado de Kiro — **requisitos → diseño → tareas** con tu feedback en cada
> fase — y luce mejor demostrado interactivamente que automatizado.

**Cómo se hará en vivo** (guion para el facilitador):

1. Entrar con el equipo ya montado: `kiro-cli --v3 chat --agent arquitecto`.
2. Pedir un spec del MVP del POS, p. ej.:
   *"Crea un spec para el MVP del POS: registrar una venta y descontar stock."*
3. Recorrer las fases que Kiro propone, aprobando/ajustando en cada una:
   - `requirements.md` → qué debe hacer (historias/criterios).
   - `design.md` → cómo (arquitectura, modelo de datos, usa el MCP de draw.io).
   - `tasks.md` → en qué pasos, para implementar incrementalmente.
4. Mostrar que los specs quedan en `.kiro/specs/<feature>/` y que `backend-dev`
   / `frontend-dev` pueden ejecutar las tareas una a una.

**La idea de cierre:** todo lo construido en los Actos 0–8 (reglas, equipo,
conocimiento, automatización, herramientas, seguridad y empaquetado) converge
aquí — el equipo de agentes convierte la **idea del POS** en un **plan ejecutable**.

---

## 📚 Recursos

- [Sitio de Kiro](https://kiro.dev)
- [Documentación](https://kiro.dev/docs)
- [Steering](https://kiro.dev/docs/steering/) · [Agents](https://kiro.dev/docs/custom-agents/) · [Skills](https://kiro.dev/docs/skills/) · [Hooks](https://kiro.dev/docs/hooks/) · [MCP](https://kiro.dev/docs/mcp/) · [Permisos](https://kiro.dev/docs/permissions/) · [Powers](https://kiro.dev/docs/powers/) · [Specs](https://kiro.dev/docs/specs/)

---

<p align="center"><em>Nos vemos en el workshop 👋</em></p>
