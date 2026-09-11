# Sécurité

## Signaler une vulnérabilité

Merci de ne pas ouvrir de ticket public pour une faille. Utilisez la
fonctionnalité « Report a vulnerability » de l'onglet Security du dépôt GitHub,
ou contactez l'auteur par le courriel indiqué sur son profil GitHub.

Indiquez : la version concernée, les étapes de reproduction, l'impact estimé.
Un accusé de réception est envoyé sous une semaine. La correction peut prendre
quelques semaines selon la gravité.

## Périmètre

Sont dans le périmètre : le code de ce dépôt (`src/`), la configuration par
défaut, la documentation de déploiement.

Ne sont pas dans le périmètre : la configuration propre à un établissement
(reverse-proxy, annuaire, réseau), les dépendances tierces (à signaler à leurs
mainteneurs, mais un ticket ici pour demander la mise à jour est bienvenu).

## Mesures en place

- Session : cookie `httpOnly`, `sameSite=lax`, `secure` derrière HTTPS, secret
  obligatoire en production, régénération de session à la connexion.
- CSRF : jeton par session injecté dans chaque formulaire `POST` et vérifié,
  y compris sur les formulaires multipart.
- En-têtes : Content-Security-Policy avec un nonce par réponse pour les scripts
  (aucune ressource externe, aucun gestionnaire d'événement en ligne),
  X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, HSTS
  derrière HTTPS.
- Connexion : blocage temporaire après cinq échecs (par adresse IP et
  identifiant), persistant en base, mots de passe locaux hachés avec scrypt,
  mots de passe AD jamais stockés.
- Autorisations : chaque route vérifie le rôle ; les référents sont limités à
  leurs applications ; les transitions d'état sont conditionnées au statut
  courant (pas d'écrasement concurrent).
- Téléversements : liste blanche d'extensions, contrôle de la signature binaire
  (PDF, PNG, JPEG, MSG), taille maximale, nom de fichier stocké neutre.
- Traçabilité : journal d'audit chaîné par SHA-256, ancrage de la tête de
  chaîne hors de la base (fichier daté, courriel), pièces empreintées,
  vérification à la demande.
- Sauvegarde : archive avec manifeste d'empreintes, restauration refusée si un
  fichier ne correspond pas.

## Points connus et choix assumés

- Les styles restent en ligne (`style-src 'unsafe-inline'`) : les gabarits
  utilisent des attributs `style`. Un style injecté ne permet pas d'exécuter
  du code ; les scripts, eux, exigent le nonce de la réponse.
- L'ancrage est un dépôt hors base, pas un horodatage tiers qualifié. Sa
  force dépend de l'endroit où l'on conserve les fichiers ou les courriels
  d'ancrage : un autre disque, un autre service, une autre équipe.
- Le chiffrement TLS n'est pas géré par l'application : un reverse-proxy est
  indispensable (voir `docs/DEPLOIEMENT.md`).
- Les pièces de preuve sont stockées en clair sur le disque de la machine, sous
  un nom neutre. Le chiffrement au repos relève du système (disque chiffré).
