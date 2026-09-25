# Installer Registris

Trois voies, selon le serveur dont dispose la DSI. Toutes partent de la
[dernière release](https://github.com/QuentinCazier/Registris/releases) : une
archive qui contient l'application **avec ses dépendances**, les installateurs,
la documentation, une nomenclature logicielle (CycloneDX) et les sommes SHA-256.
Le serveur n'a besoin ni d'accès à internet ni de `npm`.

| Serveur | Voie | Prérequis |
|---|---|---|
| Windows Server | `registris-x.y.z-installateur.exe` (assistant) ou l'archive `-windows.zip` avec `installation\windows\installer.cmd` | aucun : Node.js est embarqué |
| Linux avec systemd | `sudo installation/linux/installer.sh` depuis le `.tar.gz` | Node.js 22 ou plus récent, `openssl` pour le certificat auto-signé |
| Docker ou Proxmox | `installation/docker/docker-compose.yml` | Docker avec Compose |

Pour essayer sur un poste sans rien installer d'autre que Node.js, le dépôt
suffit : `npm install`, `npm run demo`, `npm start`.

## Vérifier l'archive

Les fichiers `SHA256SUMS` (archive Linux, nomenclature) et
`SHA256SUMS-windows.txt` (installateur et archive Windows) de la release donnent
l'empreinte de chaque fichier.

```powershell
certutil -hashfile registris-0.3.1-installateur.exe SHA256        # Windows
```

```bash
sha256sum -c SHA256SUMS                               # Linux
```

## Windows Server

### L'assistant d'installation

Téléchargez `registris-x.y.z-installateur.exe`, vérifiez sa somme SHA-256, puis
lancez-le en administrateur. Il demande le dossier, le nom de l'établissement,
le port, l'identifiant et le mot de passe de l'administrateur, et le mode HTTPS
(certificat auto-signé généré sur place, fichier PFX de votre PKI, ou pas de
HTTPS derrière un reverse-proxy). Il installe ensuite l'application, Node.js,
le service Windows et ouvre le port, puis propose d'ouvrir Registris dans le
navigateur.

Tant que l'installateur n'est pas signé par un certificat d'éditeur (voir
[SIGNATURE.md](SIGNATURE.md)), Windows SmartScreen
affiche « Windows a protégé votre ordinateur » au premier lancement. Cliquez sur
« Informations complémentaires » puis « Exécuter quand même », après avoir
comparé la somme SHA-256 à celle publiée avec la release. Le programme figure
ensuite dans « Programmes et fonctionnalités », d'où il se désinstalle (les
données sont conservées, sauf réponse contraire à la question posée).

Installation sans assistant, pour un déploiement scripté, depuis une console
PowerShell déjà ouverte en administrateur (la variable d'environnement ne
survit pas à une élévation UAC) :

```powershell
$env:REGISTRIS_MOT_DE_PASSE = '...'
.\registris-0.3.1-installateur.exe /VERYSILENT /Etablissement="CH de Ville" /Port=443 /Admin=admin /Tls=auto
```

Options : `/Tls=pfx /Pfx=C:\pki\registris.pfx /PfxMotDePasse=...`, ou `/Tls=aucun`.
Mise à jour : relancer l'installateur de la nouvelle version, la configuration
et les données sont conservées. Chaque installateur publié a été installé,
vérifié, mis à jour et désinstallé sur un serveur Windows par l'intégration
continue avant sa publication.

### L'archive portable

`registris-x.y.z-windows.zip` contient la même chose, Node.js compris, sans
assistant : décompressez, ouvrez `installation\windows` et lancez
`installer.cmd` (clic droit, exécuter en tant qu'administrateur). Il pose les
mêmes questions dans la console. À la fin, l'adresse de l'application
s'affiche. L'installateur a :
   - copié l'application dans `C:\Program Files\Registris` ;
   - créé les données dans `C:\ProgramData\Registris` (base, pièces, ancrages,
     sauvegardes, journaux) et la configuration `registris.env` au même
     endroit, lisibles seulement par les administrateurs et le service ;
   - généré un certificat auto-signé et servi l'application en HTTPS sur toutes
     les interfaces (le navigateur avertit tant que le certificat n'est pas
     celui de votre PKI) ;
   - installé le service Windows « Registris » (démarrage automatique, compte
     LocalService, journaux tournants dans le dossier `journaux`) avec le
     lanceur WinSW fourni dans l'archive, dont l'empreinte est vérifiée à la
     construction de la release ;
   - ouvert le port dans le pare-feu, profils Domaine et Privé.

Variantes du script, en PowerShell depuis `installation\windows` :

```powershell
.\installer.ps1 -Etablissement "CH de Ville" -Port 443 -Tls pfx -Certificat C:\pki\registris.pfx -MotDePassePfx '...'
.\installer.ps1 -Tls aucun            # HTTP sur 127.0.0.1 seulement, reverse-proxy IIS avec ARR devant
.\installer.ps1 -SansService          # copie et configuration, sans service ni pare-feu
```

Un PFX exporté depuis une PKI Windows doit l'être avec l'algorithme
`AES256_SHA256` (option d'`Export-PfxCertificate`) : Node refuse les exports
chiffrés en RC2. À défaut, convertissez en PEM et utilisez `-Tls pem`. Le
certificat auto-signé demande Windows Server 2022 ou plus récent (même export
AES256) : sur un serveur plus ancien, fournissez un PFX de la PKI ou choisissez
le mode sans HTTPS derrière un reverse-proxy.

Mise à jour : décompressez la nouvelle archive et relancez `installer.cmd`. Il
arrête le service, remplace l'application, conserve la configuration et les
données, redémarre. Le schéma de la base migre seul au démarrage. Faites une
sauvegarde avant (`registris sauvegarder`). Node.js suit les releases de
Registris : la mise à jour de l'un met à jour l'autre.

Désinstallation : `installation\windows\desinstaller.ps1` retire le service, la
règle de pare-feu et l'application ; les données restent, sauf avec
`-SupprimerDonnees`.

Tâches planifiées à créer ensuite (Planificateur de tâches, compte LocalService,
variable d'environnement `REGISTRIS_CONFIG` pointant sur `registris.env`) :
`sauvegarder` et `ancrer` chaque nuit, `verifier` chaque jour, `relancer` chaque
jour ouvré. Voir [DEPLOIEMENT.md](DEPLOIEMENT.md).

## Linux avec systemd

```bash
tar -xzf registris-0.3.1.tar.gz
cd registris-0.3.1
sudo installation/linux/installer.sh --etablissement "CH de Ville" --port 443
```

Le script crée l'utilisateur système `registris`, copie l'application dans
`/opt/registris`, les données dans `/var/lib/registris`, la configuration dans
`/etc/registris/registris.env`, génère un certificat auto-signé (ou prend
`--cert` et `--cle`, ou `--sans-tls` pour écouter sur 127.0.0.1 derrière un
reverse-proxy), crée le compte administrateur, installe le service `registris`
(durci : système en lecture seule, écriture limitée aux données) et la minuterie
`registris-entretien` qui, chaque nuit à 2 h, sauvegarde, ancre la chaîne
d'audit, relance les demandes en attente et vérifie l'intégrité.

Mise à jour : décompressez la nouvelle archive et relancez le script.
Désinstallation : `sudo installation/linux/desinstaller.sh`, données conservées
sauf `--supprimer-donnees`.

## Docker

```bash
mkdir registris && cd registris
curl -fsSLO https://raw.githubusercontent.com/QuentinCazier/Registris/main/installation/docker/docker-compose.yml
# adapter environment (nom de l'établissement, annuaire, courriels)
docker compose up -d
docker compose exec registris node src/cli.js utilisateur admin admin "Administrateur"
```

L'image `ghcr.io/quentincazier/registris` est construite par la release,
tourne sans privilège, expose `/sante` pour la supervision et garde la base, les
pièces et le secret de session dans le volume `registris-donnees`. Par défaut
le port n'est publié que sur l'adresse locale, pour un reverse-proxy HTTPS de
l'hôte ; avec un certificat monté dans le volume et `TLS_*` renseignés, publiez
le port sur le réseau.

Pour un essai avec les données de démonstration :

```bash
docker compose exec registris node src/cli.js demo
```

## Où sont les choses

| | Windows | Linux | Docker |
|---|---|---|---|
| Application | `C:\Program Files\Registris` | `/opt/registris` | image |
| Configuration | `C:\ProgramData\Registris\registris.env` | `/etc/registris/registris.env` | variables d'environnement |
| Base, pièces, sauvegardes | `C:\ProgramData\Registris` | `/var/lib/registris` | volume `/data` |
| Journaux | `C:\ProgramData\Registris\journaux` | `journalctl -u registris` | `docker compose logs` |

La configuration vit hors du dossier de l'application grâce à la variable
`REGISTRIS_CONFIG` : une mise à jour remplace l'application sans la toucher.
Sans `SESSION_SECRET`, un secret est généré au premier démarrage et conservé
dans `session.secret`, à côté de la base.
