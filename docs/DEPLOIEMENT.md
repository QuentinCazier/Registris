# Déploiement dans un établissement

Ce guide s'adresse à la DSI. L'objectif : une application interne, accessible
en HTTPS depuis les postes de l'établissement, authentifiée par l'Active
Directory, sauvegardée.

Les installateurs de l'archive de release (Windows, Linux, Docker, voir
[INSTALLATION.md](INSTALLATION.md)) font les étapes 1, 2, 3 et 6 en une fois.
Ce guide détaille chaque réglage, pour les adapter ou les faire à la main.

## 1. Où l'installer

- Une petite machine virtuelle Linux ou Windows suffit (1 vCPU, 1 Go de RAM,
  quelques Go de disque selon le volume de pièces).
- Node.js 22 ou plus récent (l'installateur Windows l'embarque). Aucun autre
  service : pas de base de données à installer, pas de compilateur.
- Le fichier SQLite et le dossier des preuves doivent être sur un **disque local
  de la VM**, jamais sur un partage réseau (risque de corruption).
- Tenue en charge vérifiée à chaque modification par l'intégration continue
  (`npm run charge`) : avec 50 000 habilitations, 12 000 agents et 80
  applications, chaque page répond en moins d'une seconde, la plupart en moins
  de 200 ms, et l'export complet du registre en moins de cinq secondes.

```bash
git clone https://github.com/QuentinCazier/Registris.git
cd registris
npm install --omit=dev
cp .env.example .env
```

## 2. Configuration minimale

Dans `.env` :

```ini
NOM_ETABLISSEMENT=Centre hospitalier de Ville
COULEUR_ACCENT=#12558f
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

La marque de l'établissement se pose en déposant `marque.svg` (barre haute) et
`logo.png` (page de connexion) dans `public/`, avec `favicon.ico`. La couleur de
`COULEUR_ACCENT` habille la barre haute, les boutons et les liens ; les nuances
dérivées et la couleur du texte posé dessus sont calculées pour rester lisibles.
Voir `public/README.md`.

Le fichier lu est le `.env` à la racine de l'application, ou celui que désigne
la variable d'environnement `REGISTRIS_CONFIG` (les installateurs le placent
dans `/etc/registris` ou `C:\ProgramData\Registris`, hors du dossier de
l'application, pour qu'une mise à jour ne l'écrase pas).

`SESSION_SECRET` peut rester vide : un secret est alors généré au premier
démarrage et conservé dans `session.secret`, à côté de la base, avec des droits
restreints. Pour le fixer vous-même :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 2 bis. Remplir le catalogue

« Administration, Bibliothèque » propose une liste de logiciels couramment
rencontrés en établissement, rangés par fonction. Cochez ceux de l'établissement :
les applications sont créées et les catégories correspondantes avec elles. C'est
le plus rapide pour partir d'une base vide.

Ce qui manque s'ajoute dans « Administration, Applications » : un code, un
libellé, une catégorie. La liste embarquée n'a pas vocation à être exhaustive,
et elle vieillira ; une correction se propose au dépôt du projet.

Les logos ne sont pas fournis. Ce sont des marques, que ce dépôt ne peut pas
rediffuser sous sa licence. Déposez celui de chaque application si vous en
disposez, sinon l'application porte un monogramme dont la teinte est dérivée de
son code, stable d'un écran à l'autre.

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

### HTTPS direct, sans reverse-proxy

Pour un pilote ou un serveur dédié, l'application peut porter elle-même le
certificat : `TLS_CERT` et `TLS_KEY` (PEM), ou `TLS_PFX` et
`TLS_PFX_MOT_DE_PASSE` (export d'une PKI Windows, algorithme `AES256_SHA256`).
`SECURE_COOKIE` passe alors à `true` de lui-même, et `HOTE=0.0.0.0` expose le
service sur le réseau. Sans TLS ni reverse-proxy, `HOTE` doit rester
`127.0.0.1` : le démarrage l'avertit. Les installateurs génèrent un certificat
auto-signé, à remplacer par celui de votre PKI.

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
3. Le rôle est déduit des groupes de l'agent : le nom configuré doit être le nom
   exact du groupe (ou son DN), la casse est ignorée. Seule l'appartenance
   directe compte, sauf avec `LDAP_GROUPES_IMBRIQUES=true`, qui résout les
   groupes de groupes par la règle Active Directory en chaîne (compte de service
   requis). Un agent membre d'aucun groupe est refusé, avec un message qui le
   lui dit ; ce refus n'alimente pas le compteur anti-force-brute.
4. L'identifiant de session est celui que renvoie l'annuaire, en minuscules :
   `PDurand` et `pdurand` sont la même personne au journal et dans les
   périmètres.
5. Le matricule est lu dans `employeeNumber` ou `employeeID`, le courriel dans
   `mail`. Identifiant, nom, courriel et rôle sont mémorisés à chaque connexion
   (« Administration, Comptes et référents ») : c'est ce qui permet de confier
   une demande à un référent de l'annuaire et de lui écrire, sans répliquer
   l'annuaire.

Un référent AD couvre toutes les applications par défaut. Pour le restreindre,
l'administrateur saisit son identifiant et ses applications dans
« Administration, Comptes et référents, Périmètre d'un référent de l'annuaire ».
Déclarez les périmètres dès la mise en service.

### Certificat de l'annuaire

Avec une autorité de certification interne, Node refuse le certificat du
contrôleur tant qu'il ne connaît pas cette autorité, et `registris tester-ldap`
affiche :

```
unable to verify the first certificate; if the root CA is installed locally, try running Node.js with --use-system-ca
```

Trois façons de le régler : `LDAP_CA_CERT=/chemin/vers/ca.pem` (l'autorité au
format PEM), la variable d'environnement `NODE_EXTRA_CA_CERTS` avec le même
fichier, ou l'option `--use-system-ca` de Node (magasin de certificats du
système, où une stratégie de groupe a en général déjà déployé l'autorité
interne). Le nom d'hôte de `LDAP_URL` doit figurer sur le certificat.

### Sans compte de service

Si aucun compte de service n'est possible, `LDAP_USER_DN` donne le nom de bind
à construire à partir de l'identifiant saisi, `%s` étant remplacé :
`%s@etablissement.local` ou `ETABLISSEMENT\%s`. L'agent se lie lui-même, puis
ses attributs et ses groupes directs sont lus avec ses propres droits. Les
groupes imbriqués et la recherche d'un agent par matricule ne sont pas
disponibles dans ce mode.

### Compte local de secours

Créez un compte local administrateur en ligne de commande :

```bash
registris utilisateur secours admin "Compte de secours"
```

En mode `ldap`, il ne sert que si l'annuaire est injoignable : l'application le
constate (message « annuaire injoignable », entrée `auth:annuaire-injoignable`
au journal, rien d'imputé au compteur anti-force-brute), accepte alors les
comptes locaux, et signale à l'écran que la session est ouverte en secours. Tant
que l'annuaire répond, un compte local ne permet pas de se connecter, et un mot
de passe faux sur l'annuaire ne bascule jamais sur les comptes locaux.

`LDAP_TIMEOUT_MS` (5 000 ms par défaut) borne la connexion et chaque requête :
un contrôleur qui ne répond plus donne « annuaire injoignable » dans ce délai.

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

Les installateurs de l'archive créent le service (WinSW sous Windows, unité et
minuterie systemd sous Linux, fichiers dans `installation/`). À la main,
exemple d'unité systemd :

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
l'utilisateur, attributs lus, groupes trouvés, rôle déduit, identifiant de
session, périmètre d'un référent. Chaque étape affiche OK ou ECHEC avec le
détail : message de l'annuaire, et sa traduction quand c'est un code Active
Directory connu (mot de passe incorrect, compte désactivé, verrouillé, expiré).
Une panne (contrôleur injoignable, certificat refusé) apparaît sous l'étape
« connexion à l'annuaire », un refus de l'agent sous « authentification de
l'utilisateur ». C'est l'outil à utiliser quand « la connexion ne marche pas » :
la réponse est en général dans le certificat, dans les groupes non lus (droits
du compte de service, base de recherche trop étroite) ou dans un nom de groupe
qui ne correspond pas exactement à `LDAP_GROUPE_*`.

## 7 quater. Relance des demandes en attente

Une demande oubliée dans l'outil ne vaut pas mieux qu'un mail oublié dans une
boîte. La commande relance ce qui attend depuis plus de `RELANCE_JOURS` (sept
par défaut), ouvertures comme fermetures demandées.

```bash
registris relancer --simuler   # montre qui serait relancé, sans rien envoyer
registris relancer             # envoie, et note la date de relance
```

Le courriel part à la personne qui a pris la demande en charge, ou, si personne
ne l'a prise, à l'adresse de routage de la catégorie (« Administration,
Notifications »). Une demande sans traitant ni routage est signalée en clair :
c'est le cas à corriger, sinon elle n'appelle personne. Une même demande n'est
relancée qu'une fois par période, et `APP_URL` fait pointer le courriel
directement sur la demande. Lancez `--simuler` la première fois : il montre qui
serait dérangé sans déranger personne.

L'écran le dit aussi, pour ne pas dépendre du courriel : la file de traitement
marque « en retard » ce qui dépasse le seuil, et le tableau de bord en donne le
compte.

## 7 quinquies. Tâches à planifier

| Quand | Commande | Pourquoi |
|---|---|---|
| chaque nuit | `registris sauvegarder` | l'archive, à copier hors du serveur |
| chaque jour | `registris ancrer` | déposer la tête de chaîne hors de la base |
| chaque jour | `registris verifier` | contrôle complet de la chaîne, des ancrages et du coffre |
| chaque jour ouvré | `registris relancer` | ne rien laisser dormir dans la file |
| chaque mois | `registris purger` | appliquer les durées de conservation, voir [RGPD.md](RGPD.md) |
| chaque trimestre | rapprochement de chaque application sensible, depuis l'écran | prouver que le registre dit vrai |

Le serveur fait lui-même, toutes les heures, l'entretien courant : il demande la
fermeture des accès temporaires arrivés à échéance et, une fois par jour quand un
compte de service LDAP est configuré, signale les agents dont le compte est
désactivé dans l'annuaire. `ENTRETIEN_AUTO=non` confie ce travail à une tâche
planifiée qui lance `registris entretien`.

`registris verifier` n'est pas seulement un contrôle : il enregistre un point de
reprise. Les écrans repartent de là au lieu de recalculer tout le journal, ce
qui garde le tableau de bord rapide quand l'historique atteint plusieurs
centaines de milliers d'écritures. Sans cette tâche, l'application reste juste,
mais elle revérifie tout l'historique à chaque affichage.

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
- Les sessions sont conservées dans la base : un redémarrage du service ne
  déconnecte personne, et les sessions expirées sont purgées chaque heure.
- L'API en lecture (`/api/v1`, jeton par outil) donne la file et les accès d'un
  agent à GLPI ou à la supervision : [API.md](API.md).

## 10. Protection des données

L'outil traite des données à caractère personnel d'agents (matricule, nom,
courriel professionnel, habilitations). À inscrire au registre des traitements
avec le DPO : [RGPD.md](RGPD.md) fournit la fiche, les durées de conservation et
la purge. Aucune donnée patient n'est traitée. Les pièces de preuve peuvent
contenir des courriels : sensibilisez les utilisateurs à ne joindre que les
pièces utiles à la preuve de l'habilitation.

Les extractions déposées pour un rapprochement contiennent les matricules, noms
et profils des comptes d'une application. Elles sont conservées dans la base,
donc dans les sauvegardes, parce qu'elles fondent le constat. Elles sont
lisibles par l'administration, le contrôle et le référent de l'application
concernée. Déposez l'extraction utile, pas un export plus large que nécessaire.
