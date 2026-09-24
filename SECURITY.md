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

- Session : cookie `httpOnly`, `sameSite=lax`, `secure` derrière HTTPS ou avec
  le TLS direct, secret fourni par `SESSION_SECRET` ou généré au premier
  démarrage et conservé dans `session.secret` avec des droits restreints,
  régénération de session à la connexion. Les
  sessions sont en base SQLite, purgées à l'expiration : rien ne s'accumule en
  mémoire et un redémarrage ne déconnecte personne.
- CSRF : jeton par session injecté dans chaque formulaire `POST` et vérifié,
  y compris sur les formulaires multipart. Les routes qui lisent un fichier sont
  énumérées dans `src/serveur.js` ; un corps multipart adressé à toute autre
  route est refusé avant même d'atteindre le traitement.
- En-têtes : Content-Security-Policy avec un nonce par réponse pour les scripts
  (aucune ressource externe, aucun gestionnaire d'événement en ligne),
  X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, HSTS
  derrière HTTPS.
- Connexion : blocage temporaire après cinq échecs (par adresse IP et
  identifiant), persistant en base, mots de passe locaux hachés avec scrypt,
  mots de passe AD jamais stockés. Un annuaire injoignable est distingué d'un
  mauvais mot de passe : il n'alimente pas le compteur, il est journalisé, et
  c'est le seul cas où un compte local sert de secours en mode annuaire.
- Autorisations : chaque route vérifie le rôle ; les référents sont limités à
  leurs applications, et l'identifiant de session vient de l'annuaire, en
  minuscules, pour que la casse tapée ne change ni le périmètre ni l'acteur au
  journal ; les transitions d'état sont conditionnées au statut courant (pas
  d'écrasement concurrent).
- Téléversements : liste blanche d'extensions, contrôle de la signature binaire
  (PDF, PNG, JPEG, MSG), taille maximale, nom de fichier stocké neutre.
- Traçabilité : journal d'audit chaîné par SHA-256, ancrage de la tête de
  chaîne hors de la base (fichier daté, courriel), pièces empreintées,
  vérification à la demande.
- Sauvegarde : archive avec manifeste d'empreintes, restauration refusée si un
  fichier ne correspond pas.
- Distribution : archives et installateur Windows construits par l'intégration
  continue à partir du tag, avec sommes SHA-256 et nomenclature logicielle
  CycloneDX ; Node.js pour Windows téléchargé depuis nodejs.org et vérifié par
  les sommes publiées, lanceur de service Windows (WinSW 2.12.0) vérifié par
  empreinte ; l'installateur n'est pas signé par un certificat d'éditeur
  (SmartScreen avertit, la somme SHA-256 fait foi) ; image Docker exécutée sans
  privilège.
- Exports CSV : toute cellule commençant par un signe de calcul (`=`, `+`, `-`,
  `@`, tabulation, retour chariot) est neutralisée par une apostrophe de tête.
  Les libellés d'applications, les profils et les motifs sont du texte libre, et
  le fichier produit est ouvert sur le poste d'un auditeur : sans cette
  précaution, une valeur comme `=HYPERLINK(...)` s'y exécuterait. Le traitement
  est centralisé dans `src/csv.js` et couvert par des tests, jusqu'à la
  vérification de bout en bout avec un libellé hostile.

## Points connus et choix assumés

- Les styles restent en ligne (`style-src 'unsafe-inline'`) : les gabarits
  utilisent des attributs `style`. Un style injecté ne permet pas d'exécuter
  du code ; les scripts, eux, exigent le nonce de la réponse.
- Les écrans vérifient la chaîne à partir du dernier contrôle complet
  enregistré, pas depuis la première entrée : un journal de plusieurs centaines
  de milliers de lignes rendrait sinon chaque affichage inutilisable. Le point
  de reprise est lui-même contrôlé à chaque fois (l'entrée existe, son empreinte
  est celle enregistrée, son contenu la redonne), et toute écriture postérieure
  est revérifiée. En revanche, une retouche d'une entrée **antérieure** au point
  de reprise n'apparaît plus à l'écran : elle est détectée au contrôle complet
  suivant, `registris verifier`, à planifier quotidiennement, et par les
  ancrages. Un contrôle complet peut aussi être lancé depuis la page d'audit.
- L'ancrage est un dépôt hors base, pas un horodatage tiers qualifié. Sa
  force dépend de l'endroit où l'on conserve les fichiers ou les courriels
  d'ancrage : un autre disque, un autre service, une autre équipe.
- Le chiffrement TLS n'est pas géré par l'application : un reverse-proxy est
  indispensable (voir `docs/DEPLOIEMENT.md`).
- Les pièces de preuve sont stockées en clair sur le disque de la machine, sous
  un nom neutre. Le chiffrement au repos relève du système (disque chiffré).
- La limitation de débit ne couvre que la connexion. Les autres routes exigent
  une session valide et un jeton par formulaire ; un abus depuis un compte
  authentifié se voit au journal plutôt qu'il ne s'empêche.
- `/sante` répond sans session et expose le numéro de version, pour la
  supervision. À ne pas publier hors du réseau interne.
- `/api/agent` renvoie le nom, le prénom et le courriel de l'agent d'un
  matricule à tout utilisateur connecté : c'est ce qui permet de demander un
  accès pour un collègue. Il faut connaître le matricule exact ; aucune
  recherche par nom n'est offerte à ce rôle.
- En mode annuaire, un référent sans périmètre déclaré couvre toutes les
  applications. Déclarez les périmètres dès la mise en service.
- Les groupes de l'annuaire sont reconnus par leur nom exact ; seule
  l'appartenance directe compte, sauf si `LDAP_GROUPES_IMBRIQUES` est activé.
- Les listes de traitants et les courriels des référents de l'annuaire viennent
  des comptes vus à la connexion : un référent qui ne s'est jamais connecté n'y
  figure que par un périmètre déclaré, et sans courriel.

## Revue de sécurité de la version 0.3.0

Points corrigés, tous couverts par des tests :

| Point | Correction |
|---|---|
| Injection de formule dans les exports CSV | neutralisation centralisée dans `src/csv.js` |
| Redirection ouverte : le champ `retour` acceptait `//cible`, qu'un navigateur lit comme une URL absolue | `cheminSur` refuse désormais les doubles barres obliques |
| Un agent ordinaire pouvait lire toute habilitation et rechercher tout collègue, révélant qui détient quel accès | `habilitation:lire` réservé aux rôles de suivi ; un agent ne consulte que son accès ou sa demande |
| Un agent pouvait télécharger toute pièce du coffre en énumérant `/preuves/:id` | même règle que la fiche : son accès ou sa demande, sinon 403 |
| Un `POST` au format multipart adressé à une route sans téléversement échappait à la vérification du jeton CSRF | les routes multipart sont listées ; ailleurs, un corps multipart est refusé |
| L'identifiant de session était celui tapé : `PDurand` et `pdurand` étaient deux acteurs au journal, et un référent tapant en majuscules sortait de son périmètre | identifiant canonique renvoyé par l'annuaire, en minuscules ; jointures insensibles à la casse |
| Une panne de l'annuaire se confondait avec un mauvais mot de passe, verrouillait les agents et rendait le compte local de secours inutilisable | motif distinct, journal dédié, compteur non alimenté, comptes locaux acceptés pendant la panne seulement |
| Les groupes étaient reconnus par fragment de nom : `GG_Registris_Admin_Ancien` donnait le rôle admin | correspondance exacte sur le nom ou le DN |
| Sans compte de service, la connexion échouait toujours alors que le diagnostic annonçait un bind direct | `LDAP_USER_DN` (bind direct) ou `LDAP_BIND_DN` exigé au démarrage |
| Les sessions vivaient en mémoire du processus : perdues au redémarrage, jamais purgées | magasin de sessions SQLite, purge horaire |
| Une campagne de revue rendait toutes ses lignes en une page | affichage plafonné, renvoi vers le filtre et l'export |
| Titre de campagne échappé deux fois | correction d'affichage |

Vérifiés sans anomalie : requêtes SQL toutes paramétrées, traversée de chemin à
la restauration d'archive, échappement des données d'agent dans les pages,
régénération de session et rotation du jeton à la connexion, dépendances
(`npm audit`), courriels en texte seul.
