#!/usr/bin/env bash
# =============================================================================
# UTILIDAD (opcional) — "Quiero usar MIS credenciales de Kiro"
# =============================================================================
# El sandbox trae una KIRO_API_KEY del evento para que kiro-cli funcione sin
# login. Si prefieres entrar con TU cuenta de Kiro, quita esa variable y usa el
# device-flow.
#
# IMPORTANTE: este script se debe ejecutar con 'source' para que el unset afecte
# a tu terminal actual (un script normal corre en un subshell y el unset se
# perdería al terminar):
#
#     source ./scripts/usar-mis-credenciales.sh
#
# Luego:  kiro-cli login --use-device-flow
# =============================================================================

unset KIRO_API_KEY

echo "✓ KIRO_API_KEY eliminada de esta sesión."
echo "  Ahora autentícate con tu cuenta:  kiro-cli login --use-device-flow"
echo "  (Si abres una terminal NUEVA, la key del evento vuelve: corre esto de nuevo.)"
