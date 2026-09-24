# Installer Registris

Trois voies, selon le serveur dont dispose la DSI. Toutes partent de la
[dernière release](https://github.com/QuentinCazier/Registris/releases) : une
archive qui contient l'application **avec ses dépendances**, les installateurs,
la documentation, une nomenclature logicielle (CycloneDX) et les sommes SHA-256.
Le serveur n'a besoin ni d'accès à internet ni de `npm`.

| Serveur | Voie | Prérequis |
|---|---|---|
| Windows Server | `installation\windows\installer.cmd` | Node.js 22 ou plus récent (installeur MSI de nodejs.org) |
| Linux avec systemd | `sudo installation/linux/installer.sh` | Node.js 22 ou plus récent, `openssl` pour le certificat auto-signé |
| Docker ou Proxmox | `installation/docker/docker-compose.yml` | Docker avec Compose |

Pour essayer sur un poste sans rien installer d'autre que Node.js, le dépôt
suffit : `npm install`, `npm run demo`, `npm start`.

## Vérifier l'archive

Le fichier `SHA256SUMS` de la release donne l'empreinte de chaque fichier.

```powershell
certutil -hashfile registris-0.3.0.zip SHA256        # Windows
```

```bash
sha256sum -c SHA256SUMS                               # Linux
```

## Windows Server

1. Installez Node.js LTS (22 ou plus récent) avec l'installeur MSI de
   <https://nodejs.org>, options par défaut.
2. Décompressez l'archive dans un dossier temporaire, ouvrez
   `installation\windows` et lancez `installer.cmd` (clic droit, exécuter en
   tant qu'administrateur). Il demande le nom de l'établissement, le port,
   l'identifiant et le mot de passe de l'administrateur.
3. À la fin, l'adresse de l'application s'affiche. L'installateur a :
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

Variantes, en PowerShell depuis `installation\windows` :

```powershell
.\installer.ps1 -Etablissement "CH de Ville" -Port 443 -Tls pfx -Certificat C:\pki\registris.pfx -MotDePassePfx '...'
.\installer.ps1 -Tls aucun            # HTTP sur 127.0.0.1 seulement, reverse-proxy IIS avec ARR devant
.\installer.ps1 -SansService          # copie et configuration, sans service ni pare-feu
```

Un PFX exporté depuis une PKI Windows doit l'être avec l'algorithme
`AES256_SHA256` (option d'`Export-PfxCertificate`) : Node refuse les exports
chiffrés en RC2. À défaut, convertissez en PEM et utilisez `-Tls pem`.

Mise à jour : décompressez la nouvelle archive et relancez `installer.cmd`. Il
arrête le service, remplace l'application, conserve la configuration et les
données, redémarre. Le schéma de la base migre seul au démarrage. Faites une
sauvegarde avant (`registris sauvegarder`).

Désinstallation : `installation\windows\desinstaller.ps1` retire le service, la
règle de pare-feu et l'application ; les données restent, sauf avec
`-SupprimerDonnees`.

Tâches planifiées à créer ensuite (Planificateur de tâches, compte LocalService,
variable d'environnement `REGISTRIS_CONFIG` pointant sur `registris.env`) :
`sauvegarder` et `ancrer` chaque nuit, `verifier` chaque jour, `relancer` chaque
jour ouvré. Voir [DEPLOIEMENT.md](DEPLOIEMENT.md).

## Linux avec systemd

```bash
tar -xzf registris-0.3.0.tar.gz
cd registris-0.3.0
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
