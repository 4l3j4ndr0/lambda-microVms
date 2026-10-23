#!/usr/bin/env bash
# =============================================================================
# ACTO 8 — "Seguridad: ¿qué puede y qué NO puede hacer el equipo?" (Permisos)
# =============================================================================
# Historia: nuestro equipo ya escribe archivos y ejecuta comandos. Eso es
# poderoso… y peligroso. Para el POS queremos un "operador de despliegue" que
# SOLO pueda hacer su trabajo (publicar) y NADA destructivo. En vez de confiar en
# que se porte bien, lo ENCUADRAMOS con permisos declarativos EN EL AGENTE.
#
# Feature de Kiro: PERMISSIONS (capability-based). Dos lugares para definirlos:
#   1) A NIVEL DE AGENTE (campo "permissions" + "toolsSettings" en el .json del
#      agente). Se versiona con el repo y se activa al usar ese agente. ← foco.
#   2) A NIVEL GLOBAL/WORKSPACE (permissions.yaml en ~/.kiro/...). Fuera del repo.
#   Efectos: deny / ask / allow.  Precedencia: deny > ask > allow (deny gana).
# =============================================================================

source "$(dirname "$0")/lib/common.sh"

title "ACTO 8 — Seguridad: un agente con permisos quirúrgicos"

story "Dónde vamos" \
  "Para publicar el POS creamos un 'operador de despliegue': deploy-ops." \
  "Queremos que pueda LEER el proyecto y correr SOLO comandos de deploy" \
  "(git, npm, aws), y que tenga PROHIBIDO lo destructivo (rm -rf, sudo) y" \
  "tocar secretos. No se lo pedimos 'por favor': lo imponemos con permisos."

explain "Capability-based permissions (no es un interruptor on/off)" \
  "En vez de 'confío / no confío' en todo, defines reglas POR CAPACIDAD:" \
  "  fs_read, fs_write, shell, web_fetch, web_search, mcp, subagent, skill…" \
  "Cada regla: una capacidad + patrón (match) + un efecto."

explain "Los 3 efectos y su PRECEDENCIA" \
  "  deny  → bloquea SIEMPRE (ni un prompt)." \
  "  ask   → te pregunta antes de proceder." \
  "  allow → procede en silencio." \
  "Precedencia: deny > ask > allow. Un 'deny' en CUALQUIER scope gana." \
  "Ningún allow puede sobreescribir un deny. Úsalos con intención."

explain "Dos lugares para definir permisos" \
  "  1) EN EL AGENTE: campos 'permissions' y 'toolsSettings' dentro del .json." \
  "     Se VERSIONA con el repo y viaja con el agente. Es lo que haremos ahora." \
  "  2) GLOBAL/WORKSPACE: permissions.yaml en ~/.kiro/settings o" \
  "     ~/.kiro/workspace-roots/<hash>/. Vive FUERA del repo (un repo clonado" \
  "     no puede inyectar permisos ni auto-confiarse)." \
  "Se combinan con deny-overrides: el más restrictivo gana, venga de donde venga."

pause

AGENTS="$KIRO_DIR/agents"
mkdirp "$AGENTS"

# --- deploy-ops.json: agente endurecido --------------------------------------
explain "Creamos el agente deploy-ops con permisos a nivel de agente" \
  "  tools         → qué herramientas existen para él." \
  "  toolsSettings → control fino del shell: lista blanca de comandos y" \
  "                  autoAllowReadonly (los de solo lectura no molestan)." \
  "  permissions   → reglas capability/match/effect (deny de lo peligroso," \
  "                  allow de lo cotidiano) + policies (presets reutilizables)."

DOPS="$AGENTS/deploy-ops.json"
exists_note "$DOPS"
step "Creando ${DOPS}…"
cat > "$DOPS" <<'JSON'
{
  "name": "deploy-ops",
  "description": "Operador de despliegue del POS: publica con comandos acotados (git/npm/aws). Sin acciones destructivas ni acceso a secretos.",
  "prompt": "Eres el operador de despliegue del POS. Tu trabajo es publicar la aplicación usando comandos de git, npm y AWS. Explicas en español cada paso antes de ejecutarlo. Nunca ejecutas comandos destructivos ni accedes a archivos de secretos; si algo lo requiere, lo reportas en vez de forzarlo.",
  "tools": ["fs_read", "grep", "glob", "execute_bash"],
  "allowedTools": ["fs_read", "grep", "glob"],
  "toolsSettings": {
    "shell": {
      "allowedCommands": [
        "git .*",
        "npm .*",
        "npx .*",
        "aws .*"
      ],
      "autoAllowReadonly": true
    }
  },
  "permissions": {
    "rules": [
      {
        "capability": "fs_read",
        "match": ["**/.env", "**/.env.*", "**/*.pem", "**/*.key", "secrets/**"],
        "effect": "deny"
      },
      {
        "capability": "shell",
        "match": ["rm -rf *", "sudo *", "mkfs*", "dd if=*"],
        "effect": "deny"
      },
      {
        "capability": "shell",
        "match": ["git *", "npm *", "npx *", "aws *"],
        "effect": "allow"
      },
      {
        "capability": "fs_read",
        "effect": "allow"
      }
    ],
    "policies": ["read-only-shell"]
  }
}
JSON
ok "Creado: $DOPS"
show_file "$DOPS"

step "Validando el JSON del agente…"
python3 -c "import json; json.load(open('$DOPS')); print('JSON OK')" \
  && ok "deploy-ops.json es válido." \
  || warn "deploy-ops.json tiene un error de JSON."

pause

explain "Leamos las reglas de deploy-ops como una política de seguridad" \
  "  deny  fs_read sobre .env/.pem/.key/secrets  → NO puede leer secretos." \
  "  deny  shell rm -rf/sudo/mkfs/dd             → NO puede destruir nada." \
  "  allow shell git/npm/npx/aws                  → SÍ puede desplegar." \
  "  allow fs_read                                → SÍ puede leer el proyecto." \
  "Como deny gana sobre allow, aunque 'aws *' esté permitido, un 'rm -rf' que" \
  "alguien intente colar seguirá BLOQUEADO."

explain "policies: presets de permisos reutilizables" \
  "'read-only-shell' es un preset: un conjunto con nombre de reglas de solo" \
  "lectura (git status, ls, cat, etc.) que se suma sin reescribirlas a mano." \
  "Otros presets útiles: read-workspace, edit-workspace, dev-shell, allow-all." \
  "Combínalos para armar el perfil de la sesión sin empezar de cero."

# --- Complemento: el permissions.yaml global (fuera del repo) ----------------
explain "Y el otro lugar: permissions.yaml global (fuera del repo)" \
  "Lo de arriba viaja EN el agente. Pero también puedes poner reglas que" \
  "apliquen a TODO, en ~/.kiro/settings/permissions.yaml (usuario) o en" \
  "~/.kiro/workspace-roots/<hash>/ (workspace). Dejamos un EJEMPLO para leer" \
  "en .kiro/security/ — NO es config activa, el real va fuera del repo."

SEC="$KIRO_DIR/security"
mkdirp "$SEC"
PYAML="$SEC/permissions.example.yaml"
exists_note "$PYAML"
step "Creando ${PYAML} (ejemplo de referencia)…"
cat > "$PYAML" <<'YAML'
# EJEMPLO para el taller (referencia, NO config activa).
# El permissions.yaml REAL va fuera del repo:
#   ~/.kiro/settings/permissions.yaml            (todos tus proyectos)
#   ~/.kiro/workspace-roots/<hash>/permissions.yaml  (solo este proyecto)
# Recordatorio: deny > ask > allow. Un deny gana sobre cualquier allow.

rules:
  - capability: fs_read                 # jamás leer secretos, en todo proyecto
    match: ["**/.env", "**/.env.*", "**/*.pem", "**/*.key", "secrets/**"]
    effect: deny

  - capability: shell                   # jamás comandos destructivos
    match: ["rm -rf *", "sudo *"]
    effect: deny

  - capability: shell                   # herramientas de dev habituales
    match: ["git *", "npm *", "npx *", "pytest *"]
    effect: allow

  - capability: fs_read                 # leer el proyecto, libre
    effect: allow
YAML
ok "Creado: $PYAML"
show_file "$PYAML"
pause

explain "Workspace trust: por qué un repo clonado NO manda" \
  "Kiro trata un workspace como NO CONFIABLE hasta que tú lo confías. Mientras" \
  "tanto NO carga agents/steering/MCP/skills del repo y PREGUNTA antes de cada" \
  "comando y tool MCP. Tu decisión se guarda FUERA del repo, así que un" \
  "repositorio no puede cambiar su propio estado de confianza."

explain "Invariantes que Kiro SIEMPRE impone (ni tú los cambias)" \
  "  • SIEMPRE deniega que el agente escriba sus propios settings (no puede" \
  "    auto-elevarse permisos: ~/.kiro/settings, .kiro/settings)." \
  "  • SIEMPRE pregunta antes de escribir en .git/** y en agents/hooks/powers." \
  "Tus reglas SUMAN a estos defaults; no los reemplazan."

explain "Controlarlo en vivo (CLI v3)" \
  "  /tools             → ver las herramientas de la sesión actual." \
  "  /tools trust-all   → confiar en todo por lo que resta de la sesión (pide" \
  "                       confirmación; solo para entornos desechables)." \
  "Para probar deploy-ops:  kiro-cli --v3 chat --agent deploy-ops" \
  "En headless/CI: cada 'ask' se trata como 'deny' (no hay quién responda)."

warn "Regla de oro: MÍNIMO privilegio. Deniega lo peligroso, permite lo" \
     "    cotidiano, y deja que el resto pregunte."

title "Acto 8 completado ✅"
explain "Ahora el equipo es poderoso Y acotado: deploy-ops solo puede desplegar," \
  "no destruir. Con piezas y seguridad listas, podemos EMPAQUETAR todo para" \
  "reusarlo o compartirlo: los Powers." \
  "" \
  "➡  Siguiente: ./scripts/09-powers.sh (empaquetar y compartir el equipo)"
