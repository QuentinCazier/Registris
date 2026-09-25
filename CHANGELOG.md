# Journal des versions

## 0.4.0

- Accès temporaires : une date de fin sur la demande ; à l'échéance, la
  fermeture est demandée d'elle-même au référent. Onglet « Temporaires » au
  registre, alerte sept jours avant sur le tableau de bord, date modifiable et
  tracée dans la fiche.
- Départs détectés : les comptes désactivés dans l'Active Directory, chaque
  jour, et un fichier RH des sorties ou des présents, à la demande. Chaque
  détection attend qu'un référent la confirme, ce qui demande la fermeture de
  tous les accès de l'agent, ou l'écarte avec un motif. Un fichier des présents
  qui ferait sortir plus de la moitié des agents est refusé.
- Accord du cadre, en option par application : le responsable de l'UF donne son
  accord avant que le référent ne puisse valider. Page « Accords à donner »,
  accord d'office quand le cadre dépose lui-même la demande, accord obtenu par
  courriel enregistrable par le référent. Cadres désignés par UF, à l'écran ou
  par import.
- Suppléance : un référent absent confie son périmètre à un autre pour une
  période ; le suppléant voit les demandes sans se reconnecter, et les relances
  lui parviennent.
- API en lecture (`/api/v1`) : file, registre paginé, accès d'un agent,
  catalogue. Un jeton par outil, révocable, dont seule l'empreinte est gardée.
  Voir docs/API.md.
- Conservation : `registris purger` efface l'identité des agents partis et
  supprime leurs pièces au-delà de `CONSERVATION_ANNEES` ; docs/RGPD.md fournit
  la fiche du registre des traitements.
- Entretien horaire assuré par le serveur (`ENTRETIEN_AUTO`), aussi disponible
  par `registris entretien`.
- Installateur Windows prêt à être signé par SignPath Foundation dès que le
  secret est configuré (docs/SIGNATURE.md).
- Dépendances : Express 5, Nodemailer 10, Archiver 8, ldapts 9.2.
- Qualité : ESLint et vérification des types (TypeScript sur le JavaScript) en
  intégration continue, `npm run verifier` en local.
- Nouvelle demande : les onglets de catégories ne rechargent plus la page. Une
  sélection faite dans un onglet est conservée quand on passe à un autre, ce qui
  permet de demander par exemple GAM et DPI en une seule demande groupée. Chaque
  onglet affiche le nombre d'applications cochées, et la barre du bas les nomme.
- Nouvelle demande : la carte entière d'une application se coche, un seul
  bouton « Continuer » mène au formulaire, une recherche retrouve une
  application par son nom dans toutes les catégories.
- Profil demandé : l'agent le choisit dans une liste (profils déclarés par
  l'administrateur, puis ceux déjà accordés), ou répond « Je ne sais pas ». Le
  référent le précise alors avant de valider ; la modification est tracée.
- Services : les unités fonctionnelles se cochent dans une liste filtrable, et
  celles de la dernière demande de l'agent sont cochées d'office.
- La pièce justificative est repliée dans le formulaire de l'agent.
- « Mes demandes » et l'accueil de l'agent disent où en est chaque demande
  (« En attente de validation par le référent Paie ») et affichent le motif
  d'un refus. L'accueil de l'agent montre ses dernières demandes.
- « À traiter » : une fermeture demandée propose « Fermer l'accès » au lieu
  d'« Exécuter ».
- Les historiques, l'activité récente et le journal d'audit nomment les
  personnes au lieu d'afficher leur identifiant. Les dates sont au format
  jour/mois/année.
- Le vocabulaire d'audit (écritures scellées, coffre, empreintes) quitte les
  écrans des agents et des référents ; il reste dans « Preuves et audit ».
- Signaler un départ, demander pour un collègue : l'agent se retrouve en tapant
  son nom.
- Administration : une liste « Mise en route » guide les premiers réglages ;
  « Supprimer » quitte la liste des applications pour la fiche de chacune ;
  « Importer un tableur » déclare en une fois les applications, leurs
  catégories, référents et profils, ainsi que les unités fonctionnelles.
- Menu lisible sur téléphone, chiffres des phrases dans la police du texte.
- Page « Aide » : une fiche imprimable par rôle.
- Page de connexion : le formulaire n'est plus écrasé sur les écrans de plus de
  900 px (son cadre réutilisait la classe `.boite` de « À traiter »).
- L'attribut `hidden` masque désormais toujours l'élément, même quand sa classe
  impose un `display` (barre « Demander ces accès », saisie du bénéficiaire).

## 0.3.1

- Installateur Windows complet : un assistant (`registris-x.y.z-installateur.exe`)
  qui embarque Node.js et le service, demande le nom de l'établissement, le
  port, le compte administrateur et le certificat, puis installe et démarre le
  service. Désinstallation depuis « Programmes et fonctionnalités ». Mise à jour
  en relançant l'installateur. Node.js est aussi livré dans l'archive Windows
  portable : plus aucun prérequis sur le serveur.
- Chaque installateur est construit et essayé en intégration continue sur un
  serveur Windows : installation silencieuse, service, HTTPS, compte, pare-feu,
  mise à jour, désinstallation.

## 0.3.0

Refonte de l'interface et nouveaux modules de gouvernance des accès.

- Interface : barre haute aux couleurs de l'établissement (`COULEUR_ACCENT`),
  polices auto-hébergées, boîte de traitement à deux volets, registre trié,
  filtré, paginé et exportable en CSV, fiche d'habilitation imprimable.
- Demandes : demande multiple, prise en charge par un référent, refus motivé,
  demande de fermeture d'un accès, signalement du départ d'un agent, relances
  des demandes en attente (`registris relancer`).
- Catalogue : bibliothèque de logiciels à cocher, catégories créées avec eux.
- Revue périodique des accès : campagnes, décisions par référent, rapport CSV.
- Rapprochement entre le registre et l'extraction des comptes d'une application.
- Indicateurs de délai d'ouverture et de fermeture, volumes mensuels.
- Sessions conservées en base SQLite : un redémarrage ne déconnecte personne.
- Annuaire : identifiant de session canonique (casse ignorée), comptes de
  l'annuaire mémorisés à la connexion (traitants, courriels, page
  d'administration), compte local de secours accepté seulement quand l'annuaire
  est injoignable, panne distinguée d'un mauvais mot de passe, groupes reconnus
  par nom exact, groupes imbriqués en option (`LDAP_GROUPES_IMBRIQUES`), bind
  direct sans compte de service (`LDAP_USER_DN`), certificat d'autorité
  (`LDAP_CA_CERT`), délais (`LDAP_TIMEOUT_MS`), file de traitement limitée au
  périmètre du référent, recherche d'un agent dans l'annuaire par matricule,
  diagnostic `tester-ldap` avec les codes Active Directory traduits.
- Sécurité : exports CSV protégés contre l'injection de formules, redirection
  ouverte fermée, lecture du registre réservée aux rôles de suivi, jeton CSRF
  exigé même pour un corps multipart adressé à une route sans téléversement,
  téléchargement d'une pièce soumis aux mêmes droits que sa fiche.
- Accessibilité : contrôles automatiques sur toutes les pages, contrastes
  corrigés, légendes et portées des tableaux, documentation dédiée.
- Site de présentation publié sur GitHub Pages depuis le dossier `site/`.
- Installation : archive de release avec les dépendances, installateur Windows
  (service WinSW, certificat auto-signé, compte administrateur, pare-feu),
  script Linux (systemd durci, minuterie d'entretien quotidienne), image Docker
  sur ghcr.io, configuration hors du dossier de l'application
  (`REGISTRIS_CONFIG`), HTTPS direct (`TLS_CERT` et `TLS_KEY`, ou `TLS_PFX`),
  secret de session généré au premier démarrage, sommes SHA-256 et nomenclature
  CycloneDX attachées à la release.
- Dépendances : multer 2.4.0, qui corrige douze avis de déni de service par
  requêtes multipart malformées (la version 1.4.5-lts échappait à `npm audit`
  à cause de son suffixe de préversion) ; tests dédiés aux corps multipart
  tronqués, trop volumineux ou aux noms de champs hostiles.
- Corrections : double BOM dans les exports CSV du registre et de la revue,
  autres accès de l'agent listés par son identifiant et non par recherche
  textuelle, création de compte en ligne de commande tracée et refusée en cas de
  doublon, guillemets acceptés autour des valeurs du fichier `.env`.

## 0.2.0

- Ancrage de la chaîne d'audit hors de la base, sauvegarde et restauration avec
  manifeste, anti-force-brute persistant, CSP avec nonce, diagnostic LDAP.

## 0.1.0

- Première version : registre des habilitations, coffre à preuves, journal
  d'audit chaîné, dossier de preuves pour l'auditeur, authentification locale ou
  Active Directory.
