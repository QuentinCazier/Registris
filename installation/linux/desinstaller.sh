#!/usr/bin/env bash
# Désinstallation de Registris sur Linux : arrête et retire le service et la minuterie, supprime
# /opt/registris. Les données et la configuration sont conservées, sauf avec --supprimer-donnees.
set -uo pipefail
[ "$(id -u)" = 0 ] || { echo "à lancer en root (sudo)" >&2; exit 1; }
SUPPRIMER=0
[ "${1:-}" = "--supprimer-donnees" ] && SUPPRIMER=1
systemctl disable --now registris-entretien.timer registris 2>/dev/null
rm -f /etc/systemd/system/registris.service /etc/systemd/system/registris-entretien.service /etc/systemd/system/registris-entretien.timer
systemctl daemon-reload
rm -rf /opt/registris
echo "Application supprimée : /opt/registris"
if [ "$SUPPRIMER" = 1 ]; then
  rm -rf /var/lib/registris /etc/registris
  userdel registris 2>/dev/null
  echo "Données, configuration et compte système supprimés."
else
  echo "Données conservées : /var/lib/registris et /etc/registris (base, pièces, configuration, sauvegardes)."
fi
