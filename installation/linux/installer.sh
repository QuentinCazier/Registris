#!/usr/bin/env bash
# Installation de Registris sur Linux avec systemd : application dans /opt/registris, données dans
# /var/lib/registris, configuration dans /etc/registris/registris.env, service « registris » et
# minuterie d'entretien quotidienne. Relancé sur une installation existante, met à jour sans toucher
# aux données.
#
#   sudo ./installer.sh [--etablissement "CH de Ville"] [--port 3000] [--admin admin]
#                       [--cert registris.crt --cle registris.key | --sans-tls | --auto-signe]
#                       [--sans-service] [--silencieux]
# En mode silencieux, le mot de passe administrateur est lu dans REGISTRIS_MOT_DE_PASSE.
set -euo pipefail

DOSSIER=/opt/registris
DONNEES=/var/lib/registris
CONFIG_DIR=/etc/registris
CONFIG=$CONFIG_DIR/registris.env
PORT=3000
ETABLISSEMENT=""
ADMIN=admin
TLS=auto
CERT=""
CLE=""
SANS_SERVICE=0
SILENCIEUX=0

while [ $# -gt 0 ]; do
  case "$1" in
    --etablissement) ETABLISSEMENT=$2; shift 2 ;;
    --port) PORT=$2; shift 2 ;;
    --admin) ADMIN=$2; shift 2 ;;
    --cert) CERT=$2; TLS=pem; shift 2 ;;
    --cle) CLE=$2; TLS=pem; shift 2 ;;
    --sans-tls) TLS=aucun; shift ;;
    --auto-signe) TLS=auto; shift ;;
    --dossier) DOSSIER=$2; shift 2 ;;
    --donnees) DONNEES=$2; shift 2 ;;
    --config) CONFIG=$2; CONFIG_DIR=$(dirname "$2"); shift 2 ;;
    --sans-service) SANS_SERVICE=1; shift ;;
    --silencieux) SILENCIEUX=1; shift ;;
    *) echo "option inconnue : $1" >&2; exit 1 ;;
  esac
done

etape() { printf '\n== %s\n' "$1"; }
echec() { printf 'ECHEC : %s\n' "$1" >&2; exit 1; }

etape "Vérifications"
SOURCE=$(cd "$(dirname "$0")/../.." && pwd)
[ -f "$SOURCE/package.json" ] || echec "package.json introuvable dans $SOURCE : lancez ce script depuis l'archive décompressée."
[ -d "$SOURCE/node_modules" ] || echec "node_modules absent : utilisez l'archive de release (dépendances incluses), pas le dépôt git."
if [ "$SANS_SERVICE" = 0 ] && [ "$(id -u)" != 0 ]; then echec "à lancer en root (sudo), ou avec --sans-service."; fi
command -v node >/dev/null || echec "Node.js est absent : installez Node.js 22 LTS ou plus récent (https://nodejs.org, ou le paquet de votre distribution)."
MAJEURE=$(node --version | sed 's/^v//; s/\..*//')
[ "$MAJEURE" -ge 22 ] || echec "Node.js $MAJEURE trouvé, version 22 minimum requise."
VERSION=$(node -p "require('$SOURCE/package.json').version")
MISE_A_JOUR=0
[ -f "$CONFIG" ] && MISE_A_JOUR=1
echo "Registris $VERSION, Node.js $(node --version), $([ "$MISE_A_JOUR" = 1 ] && echo 'mise à jour' || echo 'nouvelle installation')"

MOT_DE_PASSE=""
if [ "$MISE_A_JOUR" = 0 ]; then
  if [ "$SILENCIEUX" = 1 ]; then
    [ -n "${REGISTRIS_MOT_DE_PASSE:-}" ] || echec "en mode silencieux, REGISTRIS_MOT_DE_PASSE doit contenir le mot de passe administrateur."
    MOT_DE_PASSE=$REGISTRIS_MOT_DE_PASSE
  else
    etape "Paramètres"
    [ -n "$ETABLISSEMENT" ] || read -r -p "Nom de l'établissement : " ETABLISSEMENT
    read -r -p "Port d'écoute [$PORT] : " p; [ -n "$p" ] && PORT=$p
    read -r -p "Identifiant de l'administrateur [$ADMIN] : " a; [ -n "$a" ] && ADMIN=$a
    while :; do
      read -r -s -p "Mot de passe de $ADMIN (12 caractères minimum) : " m1; echo
      read -r -s -p "Confirmez : " m2; echo
      if [ "$m1" = "$m2" ] && [ ${#m1} -ge 12 ]; then MOT_DE_PASSE=$m1; break; fi
      echo "Les deux saisies diffèrent ou font moins de 12 caractères."
    done
  fi
fi

etape "Compte système et dossiers"
if [ "$SANS_SERVICE" = 0 ]; then
  id registris >/dev/null 2>&1 || useradd --system --home-dir "$DONNEES" --shell /usr/sbin/nologin registris
  PROPRIO=registris
else
  PROPRIO=$(id -un)
fi
mkdir -p "$DOSSIER" "$DONNEES"/{preuves,logos,ancrages,sauvegardes} "$CONFIG_DIR/tls"

etape "Copie de l'application vers $DOSSIER"
if [ "$SANS_SERVICE" = 0 ] && systemctl is-active --quiet registris; then systemctl stop registris; echo "Service arrêté."; fi
if command -v rsync >/dev/null; then
  rsync -a --delete --exclude .git "$SOURCE/" "$DOSSIER/"
else
  rm -rf "$DOSSIER"/* && cp -a "$SOURCE"/. "$DOSSIER"/
fi
chown -R root:root "$DOSSIER"
chown -R "$PROPRIO":"$PROPRIO" "$DONNEES"
chmod 750 "$DONNEES"

if [ "$MISE_A_JOUR" = 0 ]; then
  etape "Certificat et configuration"
  HOTE=0.0.0.0
  TLS_LIGNES=""
  case "$TLS" in
    aucun)
      HOTE=127.0.0.1
      TLS_LIGNES="# Sans TLS : écoute locale seulement, à exposer par un reverse-proxy HTTPS (nginx, Apache)."
      echo "Sans TLS : l'application n'écoutera que sur 127.0.0.1." ;;
    pem)
      [ -f "$CERT" ] && [ -f "$CLE" ] || echec "certificat ou clé introuvable (--cert, --cle)"
      install -m 640 -o root -g "$PROPRIO" "$CERT" "$CONFIG_DIR/tls/registris.crt"
      install -m 640 -o root -g "$PROPRIO" "$CLE" "$CONFIG_DIR/tls/registris.key"
      TLS_LIGNES="TLS_CERT=$CONFIG_DIR/tls/registris.crt
TLS_KEY=$CONFIG_DIR/tls/registris.key"
      echo "Certificat et clé copiés dans $CONFIG_DIR/tls." ;;
    auto)
      command -v openssl >/dev/null || echec "openssl absent : fournissez --cert et --cle, ou --sans-tls."
      HOTE_NOM=$(hostname -f 2>/dev/null || hostname)
      openssl req -x509 -newkey rsa:2048 -nodes -days 1095 -subj "/CN=$HOTE_NOM" \
        -addext "subjectAltName=DNS:$HOTE_NOM,DNS:localhost" \
        -keyout "$CONFIG_DIR/tls/registris.key" -out "$CONFIG_DIR/tls/registris.crt" >/dev/null 2>&1
      chown root:"$PROPRIO" "$CONFIG_DIR/tls/registris.key" "$CONFIG_DIR/tls/registris.crt"
      chmod 640 "$CONFIG_DIR/tls/registris.key" "$CONFIG_DIR/tls/registris.crt"
      TLS_LIGNES="# Certificat auto-signé généré à l'installation pour $HOTE_NOM : le navigateur avertira.
# Remplacez-le par un certificat de votre PKI (TLS_CERT et TLS_KEY).
TLS_CERT=$CONFIG_DIR/tls/registris.crt
TLS_KEY=$CONFIG_DIR/tls/registris.key"
      echo "Certificat auto-signé créé pour $HOTE_NOM." ;;
  esac
  SECRET=$(od -An -N48 -tx1 /dev/urandom | tr -d ' \n')
  cat > "$CONFIG" <<EOF
# Configuration de Registris, lue par le service (variable REGISTRIS_CONFIG). Modèle complet : $DOSSIER/.env.example
NOM_ETABLISSEMENT=$ETABLISSEMENT
NODE_ENV=production
HOTE=$HOTE
PORT=$PORT
SESSION_SECRET=$SECRET
DB_PATH=$DONNEES/registris.db
PREUVES_DIR=$DONNEES/preuves
LOGOS_DIR=$DONNEES/logos
ANCRAGES_DIR=$DONNEES/ancrages
SAUVEGARDES_DIR=$DONNEES/sauvegardes
$TLS_LIGNES
AUTH_MODE=local
# Active Directory : AUTH_MODE=ldap puis les lignes LDAP_* du modèle .env.example.
# Courriels : SMTP_HOST=smtp.etablissement.local et SMTP_FROM=registris@etablissement.fr.
EOF
  chown root:"$PROPRIO" "$CONFIG"
  chmod 640 "$CONFIG"
  echo "Configuration écrite : $CONFIG"

  etape "Compte administrateur « $ADMIN »"
  if [ "$SANS_SERVICE" = 0 ]; then
    su -s /bin/sh -c "REGISTRIS_CONFIG='$CONFIG' REGISTRIS_MOT_DE_PASSE='$MOT_DE_PASSE' node '$DOSSIER/src/cli.js' utilisateur '$ADMIN' admin Administrateur" registris
  else
    REGISTRIS_CONFIG="$CONFIG" REGISTRIS_MOT_DE_PASSE="$MOT_DE_PASSE" node "$DOSSIER/src/cli.js" utilisateur "$ADMIN" admin Administrateur
  fi
else
  HOTE=$(sed -n 's/^HOTE=//p' "$CONFIG" | head -1)
  PORT=$(sed -n 's/^PORT=//p' "$CONFIG" | head -1)
  echo "Configuration conservée : $CONFIG"
fi
TLS_ACTIF=$(grep -E '^(TLS_CERT|TLS_PFX)=' "$CONFIG" | head -1 || true)
SCHEMA=http; [ -n "$TLS_ACTIF" ] && SCHEMA=https

if [ "$SANS_SERVICE" = 0 ]; then
  etape "Service systemd"
  sed "s#/opt/registris#$DOSSIER#g; s#/etc/registris/registris.env#$CONFIG#g; s#/var/lib/registris#$DONNEES#g" \
    "$DOSSIER/installation/linux/registris.service" > /etc/systemd/system/registris.service
  sed "s#/opt/registris#$DOSSIER#g; s#/etc/registris/registris.env#$CONFIG#g; s#/var/lib/registris#$DONNEES#g" \
    "$DOSSIER/installation/linux/registris-entretien.service" > /etc/systemd/system/registris-entretien.service
  cp "$DOSSIER/installation/linux/registris-entretien.timer" /etc/systemd/system/registris-entretien.timer
  systemctl daemon-reload
  systemctl enable --now registris registris-entretien.timer >/dev/null 2>&1 || systemctl enable --now registris
  systemctl restart registris
  echo "Service démarré, minuterie d'entretien quotidienne activée."

  etape "Vérification"
  OK=0
  for i in $(seq 1 20); do
    sleep 1
    if curl -fsk "$SCHEMA://127.0.0.1:$PORT/sante" >/dev/null 2>&1; then OK=1; break; fi
  done
  [ "$OK" = 1 ] || echec "le service ne répond pas sur $SCHEMA://127.0.0.1:$PORT/sante ; voir journalctl -u registris"
  echo "Réponse reçue : $(curl -sk "$SCHEMA://127.0.0.1:$PORT/sante")"
fi

etape "Terminé"
if [ "$HOTE" = 127.0.0.1 ]; then echo "Registris $VERSION : $SCHEMA://127.0.0.1:$PORT/"; else echo "Registris $VERSION : $SCHEMA://$(hostname -f 2>/dev/null || hostname):$PORT/"; fi
[ "$MISE_A_JOUR" = 0 ] && echo "Compte administrateur : $ADMIN"
echo "Configuration : $CONFIG"
echo "Données et sauvegardes : $DONNEES"
[ "$SANS_SERVICE" = 1 ] && echo "Démarrage manuel : REGISTRIS_CONFIG=$CONFIG node $DOSSIER/src/cli.js servir"
echo "Étapes suivantes : Active Directory et courriels dans la configuration ; l'entretien quotidien"
echo "(sauvegarde, ancrage, relances, vérification) tourne par la minuterie registris-entretien."
