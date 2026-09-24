# Journal des versions

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
