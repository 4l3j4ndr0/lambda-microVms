#!/usr/bin/env bash
# Mensaje de bienvenida que se muestra al abrir una terminal interactiva.
# Se invoca desde ~/.bashrc (que escribe app.py en cada boot). Colores Dracula.

PURPLE=$'\033[38;5;141m'
GREEN=$'\033[38;5;84m'
CYAN=$'\033[38;5;117m'
YELLOW=$'\033[38;5;228m'
DIM=$'\033[2m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

cat <<EOF

${PURPLE}${BOLD}  🧛  Kiro Day Medellín 2026${RESET}
${DIM}  ──────────────────────────────────────────────${RESET}
  ${GREEN}¡Bienvenido a tu entorno de desarrollo!${RESET}

  ${CYAN}1.${RESET} Inicia sesión en Kiro CLI (device flow):

       ${YELLOW}${BOLD}kiro-cli login --use-device-flow${RESET}

  ${CYAN}2.${RESET} Empieza a usar el agente:

       ${YELLOW}${BOLD}kiro-cli chat${RESET}

${DIM}  ──────────────────────────────────────────────${RESET}

EOF
