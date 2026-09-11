# Déploiement dans un établissement

Ce guide s'adresse à la DSI. L'objectif : une application interne, accessible
en HTTPS depuis les postes de l'établissement, authentifiée par l'Active
Directory, sauvegardée.

## 1. Où l'installer

- Une petite machine virtuelle Linux ou Windows suffit (1 vCPU, 1 Go de RAM,
  quelques Go de disque selon le volume de pièces).
- Node.js 22 ou plus récent. Aucun autre service : pas de base de données à
  installer, pas de compilateur.
- Le fichier SQLite et le dossier des preuves doivent être sur un **disque local
  de la VM**, jamais sur un partage réseau (risque de corruption).

```bash
git clone https://github.com/QuentinCazier/registris.git
cd registris
npm install --omit=dev
cp .env.example .env
```

## 2. Configuration minimale

Dans `.env` :

```ini
NOM_ETABLISSEMENT=Centre hospitalier de Ville
NODE_ENV=production
SESSION_SECRET=<valeur longue et aléatoire>
SECURE_COOKIE=true
TRUST_PROXY=true
HOTE=127.0.0.1
PORT=3000
DB_PATH=/var/lib/registris/registris.db
PREUVES_DIR=/var/lib/registris/preuves
LOGOS_DIR=/var/lib/registris/logos
```

Génération du secret :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

En production, l'application **refuse de démarrer** sans `SESSION_SECRET`.

## 3. HTTPS par reverse-proxy

L'application écoute en HTTP sur `127.0.0.1:3000`. Un reverse-proxy porte le
certificat (interne ou public) et transmet les requêtes. Exemple nginx :

```nginx
server {
    listen 443 ssl;
    server_name habilitations.etablissement.local;
    ssl_certificate     /etc/ssl/certs/habilitations.crt;
    ssl_certificate_key /etc/ssl/private/habilitations.key;
    client_max_body_size 30m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Sous Windows, IIS avec Application Request Routing joue le même rôle. Le point
important : les mots de passe Active Directory transitent au moment de la
connexion, donc **jamais en HTTP clair** au-delà de la machine elle-même.

## 4. Active Directory

```ini
AUTH_MODE=ldap
LDAP_URL=ldaps://dc01.etablissement.local:636
LDAP_BASE_DN=DC=etablissement,DC=local
LDAP_LOGIN_ATTR=sAMAccountName
LDAP_BIND_DN=CN=svc_registris,OU=Comptes de service,DC=etablissement,DC=local
LDAP_BIND_PASSWORD=<mot de passe du compte de service>
LDAP_GROUPE_ADMIN=GG_Registris_Admin
LDAP_GROUPE_CONTROLEUR=GG_Registris_Controleur
LDAP_GROUPE_REFERENT=GG_Registris_Referent
LDAP_GROUPE_UTILISATEUR=GG_Registris_Utilisateur
```

Fonctionnement :

1. L'agent saisit son identifiant Windows et son mot de passe.
2. L'application retrouve son entrée dans l'annuaire grâce au compte de service
   (lecture seule), puis demande au contrôleur de domaine de valider le mot de
   passe (bind). Le mot de passe n'est jamais stocké.
3. Le rôle est déduit des groupes de l'agent (le nom de groupe configuré est
   cherché comme fragment, insensible à la casse). Un agent membre d'aucun
   groupe est refusé.
4. Le matricule est lu dans `employeeNumber` ou `employeeID`, le courriel dans
   `mail`.

Un référent AD couvre toutes les applications par défaut. Pour le restreindre,
l'administrateur saisit son identifiant et ses applications dans
« Administration, Comptes et référents, Périmètre d'un référent de l'annuaire ».

Conservez un compte local administrateur de secours, créé en ligne de commande,
pour le cas où l'annuaire serait indisponible :

```bash
registris utilisateur secours admin "Compte de secours"
```

## 5. Notifications

```ini
SMTP_HOST=smtp.etablissement.local
SMTP_PORT=25
SMTP_FROM=registris@etablissement.fr
```

La plupart des relais Exchange internes acceptent les envois sans
authentification depuis une adresse IP de confiance. Sans `SMTP_HOST`, aucun
courriel ne part et tout le reste fonctionne.

Les destinataires des nouvelles demandes se règlent par catégorie dans
« Administration, Notifications ». Le demandeur et le bénéficiaire sont
prévenus à chaque changement de statut si leur courriel est connu.

## 6. Service système

Exemple d'unité systemd :

```ini
[Unit]
Description=Registris
After=network.target

[Service]
User=registris
WorkingDirectory=/opt/registris
ExecStart=/usr/bin/node src/cli.js servir
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Sous Windows, le service peut être créé avec `nssm` ou une tâche planifiée
« au démarrage ».

## 7. Sauvegardes et restauration

```bash
registris sauvegarder                 # archive dans SAUVEGARDES_DIR (défaut ./sauvegardes)
registris sauvegarder /mnt/sauvegardes/registris
```

L'archive ZIP est autoportante : copie cohérente de la base (obtenue sans
arrêter le service), pièces du coffre, logos, fichiers d'ancrage, et un
manifeste avec la version, les compteurs, l'état de la chaîne d'audit et
l'empreinte SHA-256 de chaque fichier. Planifiez la commande chaque nuit
(cron ou tâche systemd) et copiez l'archive hors du serveur ; le nom porte
l'horodatage.

```bash
registris restaurer sauvegarde.zip --verifier   # contrôle l'archive sans rien écrire
registris restaurer sauvegarde.zip              # redéploie (service arrêté, base absente)
registris restaurer sauvegarde.zip --forcer     # remplace une base existante
```

La restauration refuse une archive dont un fichier ne correspond pas au
manifeste, et refuse d'écraser une base sans `--forcer`. Après restauration,
`registris verifier` recalcule la chaîne d'audit, confronte les
ancrages et vérifie chaque pièce contre son empreinte, puis on redémarre le
service. Testez la restauration sur une machine à part au moins une fois par
an : une sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde.

## 7 bis. Ancrage de la chaîne d'audit

La chaîne prouve qu'aucune entrée du journal n'a été modifiée après coup. Elle
ne prouve pas, à elle seule, que la base n'a pas été remplacée par une autre
base cohérente. L'ancrage comble ce point : il photographie la tête de chaîne
(dernier identifiant, dernière empreinte, nombre d'entrées) et la dépose hors
de la base.

```bash
registris ancrer
```

Chaque ancrage est enregistré en base, écrit dans un fichier daté du dossier
`ANCRAGES_DIR` (choisissez un autre disque, ou un partage en écriture seule
géré par une autre équipe) et, si `ANCRAGE_EMAIL` est renseigné, envoyé par le
relais SMTP à une boîte fonctionnelle (contrôle interne, RSSI). Planifiez la
commande chaque jour. `registris verifier` confronte ensuite chaque
ancrage, en base et dans le dossier, à la chaîne courante : entrée de tête
disparue ou modifiée, compte différent, fichier manquant ou inconnu de la base
sont signalés. La page « Journal d'audit » affiche la date du dernier ancrage.

## 7 ter. Tester l'annuaire avant la mise en service

```bash
registris tester-ldap jdupont
```

Le mot de passe est demandé au clavier. La commande déroule pas à pas ce que
fait la connexion : lecture de la configuration, bind et recherche de
l'utilisateur, attributs lus, groupes trouvés, rôle déduit, périmètre d'un
référent. Chaque étape affiche OK ou ECHEC avec le détail (message de
l'annuaire, code d'erreur). C'est l'outil à utiliser quand « la connexion ne
marche pas » : la réponse est en général dans les groupes non lus (droits du
compte de service, base de recherche trop étroite) ou dans un nom de groupe
qui ne correspond pas à `LDAP_GROUPE_*`.

## 8. Mise à jour

```bash
git pull
npm install --omit=dev
systemctl restart registris
```

Le schéma de base se met à jour tout seul au démarrage (migrations additives).

## 9. Journalisation et supervision

- `GET /sante` renvoie un JSON (`{"statut":"ok"}`) sans authentification, pour
  votre supervision.
- Les connexions réussies, échouées et bloquées sont dans le journal d'audit,
  avec l'adresse IP d'origine (correcte si `TRUST_PROXY=true` derrière le proxy).

## 10. Protection des données

L'outil traite des données à caractère personnel d'agents (matricule, nom,
courriel professionnel, habilitations). À inscrire au registre des traitements
avec le DPO. Aucune donnée patient n'est traitée. Les pièces de preuve peuvent
contenir des courriels : sensibilisez les utilisateurs à ne joindre que les
pièces utiles à la preuve de l'habilitation.
