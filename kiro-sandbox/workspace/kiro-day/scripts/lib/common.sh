#!/usr/bin/env bash
# common.sh — helpers compartidos por los scripts del workshop Kiro Day.
#
# Se importa al inicio de cada script del taller con:
#   source "$(dirname "$0")/lib/common.sh"
#
# Filosofía del taller: cada script "explica mientras hace". Estos helpers dan
# colores, títulos, bloques de explicación y pausas para que el facilitador
# hable antes de que el script cree los archivos. Así la salida del script es,
# literalmente, el guion de la charla.

set -euo pipefail

# --- Colores (se desactivan solos si la salida no es una terminal) -----------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
  BLUE=$'\033[34m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
  CYAN=$'\033[36m'; MAGENTA=$'\033[35m'; RED=$'\033[31m'
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""; CYAN=""; MAGENTA=""; RED=""
fi

# Raíz del workspace del taller (el padre de scripts/). Los scripts crean la
# estructura .kiro/ relativa a aquí, sin importar desde dónde se ejecuten.
WORKSHOP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KIRO_DIR="$WORKSHOP_ROOT/.kiro"

# --- Salida estructurada -----------------------------------------------------

# Título de acto/sección.
title() {
  echo
  echo "${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo "${BOLD}${MAGENTA}  $*${RESET}"
  echo "${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

# Bloque de explicación: primer argumento es el encabezado, el resto líneas.
explain() {
  echo
  echo "${CYAN}${BOLD}💡 $1${RESET}"
  shift || true
  for line in "$@"; do
    echo "${CYAN}   $line${RESET}"
  done
}

# Narrativa de la historia (el "caso de uso" del POS), en otro color.
story() {
  echo
  echo "${BLUE}${BOLD}🎬 $1${RESET}"
  shift || true
  for line in "$@"; do
    echo "${BLUE}   $line${RESET}"
  done
}

step() { echo "${YELLOW}▶ $*${RESET}"; }   # acción a punto de ejecutarse
ok()   { echo "${GREEN}✓ $*${RESET}"; }    # resultado exitoso
warn() { echo "${RED}⚠ $*${RESET}"; }      # advertencia

# Muestra el contenido de un archivo recién creado, enmarcado.
show_file() {
  local f="$1"
  echo
  echo "${DIM}┌─ $f${RESET}"
  sed 's/^/'"${DIM}"'│ '"${RESET}"'/' "$f"
  echo "${DIM}└─${RESET}"
}

# Pausa para que el facilitador hable. Se salta exportando WORKSHOP_NOWAIT=1.
pause() {
  if [ "${WORKSHOP_NOWAIT:-0}" = "1" ]; then return 0; fi
  echo
  read -r -p "${DIM}  (Enter para continuar…)${RESET}" _ || true
}

# Crea un directorio narrando la acción.
mkdirp() {
  step "mkdir -p $1"
  mkdir -p "$1"
  ok "Directorio listo: ${BOLD}$1${RESET}"
}

# Verifica idempotencia: avisa si un archivo ya existe (para re-ejecuciones).
exists_note() {
  if [ -e "$1" ]; then
    warn "Ya existe ${BOLD}$1${RESET} — se sobrescribirá con la versión del taller."
  fi
}
