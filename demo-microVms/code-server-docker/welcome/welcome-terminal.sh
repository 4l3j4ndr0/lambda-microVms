#!/usr/bin/env bash
# Mensaje de bienvenida que se muestra al abrir una terminal interactiva.
# Se invoca desde ~/.bashrc. Colores estilo Dracula.

PURPLE=$'\033[38;5;141m'
GREEN=$'\033[38;5;84m'
CYAN=$'\033[38;5;117m'
DIM=$'\033[2m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

cat <<EOF

${PURPLE}${BOLD}  🧛  Kiro Day Medellín 2026${RESET}
${DIM}  ──────────────────────────────────────────────${RESET}
  ${GREEN}¡Bienvenido a tu entorno de desarrollo!${RESET}

  ${CYAN}•${RESET} Estás en el workspace ${BOLD}kiro-day${RESET}
  ${CYAN}•${RESET} Kiro CLI disponible:   ${BOLD}kiro-cli${RESET}
${DIM}  ──────────────────────────────────────────────${RESET}

EOF
