# S'en servir pendant un audit

Ce document décrit ce qu'Registris produit face à un contrôle et comment
préparer l'établissement pour que le jour J se passe en dix minutes.

## Ce que demandent les auditeurs

Dans le cadre de la certification des comptes, les commissaires aux comptes
évaluent les **contrôles généraux informatiques** : gestion des accès aux
applications qui alimentent les comptes (facturation, paie, gestion économique).
Ils échantillonnent des agents et demandent, pour chacun :

- la liste de ses accès et profils sur ces applications ;
- la preuve que chaque accès a été **demandé** par une personne habilitée ;
- la preuve qu'il a été **validé** ;
- la date d'ouverture, et la date de **révocation** pour les agents partis ;
- la cohérence entre le profil demandé et le profil réellement ouvert.

Le référentiel PGSSI-S et les audits internes posent les mêmes questions sur
les applications contenant des données de santé.

## Ce que fournit l'outil

Menu « Audit, Dossier de preuves » : collez les matricules, obtenez un ZIP :

| Fichier | Contenu |
|---|---|
| `synthese.html` | par agent, toutes ses habilitations avec dates de demande, validation, réalisation, révocation, demandeur, historique tracé et liste des pièces avec leur état d'intégrité ; imprimable en PDF |
| `synthese.csv` | le même tableau, pour Excel |
| `integrite.txt` | l'empreinte SHA-256 de chaque pièce telle qu'enregistrée au dépôt, et l'état de la chaîne d'audit |
| `<matricule>/<n°>_<application>/…` | les pièces elles-mêmes, classées par agent et par habilitation |

L'export est lui-même tracé au journal (qui a exporté quoi, quand).

## Ce qui rend le registre crédible

- **Journal chaîné** : chaque action est scellée par l'empreinte de la
  précédente. Un auditeur peut demander une vérification à l'écran (« Audit,
  Journal d'audit ») ou en ligne de commande (`registris verifier`).
- **Ancrage** : chaque jour, l'empreinte de tête de la chaîne est déposée hors
  de la base (fichier daté, courriel à une boîte de contrôle). L'auditeur peut
  confronter un ancrage de sa propre boîte à la chaîne courante : si la base
  avait été remplacée, l'écart apparaîtrait.
- **Contrôle complet daté** : la page d'audit indique la date du dernier
  contrôle complet et permet d'en lancer un devant l'auditeur. Entre deux
  contrôles, l'affichage repart du dernier point de reprise pour rester
  utilisable sur un gros journal ; la planification quotidienne de
  `registris verifier` est ce qui donne sa valeur à l'ensemble.
- **Pièces empreintées** : une pièce modifiée après son dépôt est signalée
  « altérée » dans l'application et dans le dossier exporté.
- **Séparation des rôles** : le demandeur ne valide pas, le référent ne valide
  que ses applications, le contrôleur lit et exporte sans pouvoir modifier.
- **Historique par habilitation** : sur chaque fiche, la liste horodatée de qui
  a fait quoi.

## Les fermetures d'accès

C'est le point sur lequel un établissement est le plus souvent pris en défaut :
l'accès qu'on n'a jamais fermé. Registris distingue trois choses que les
tableaux Excel confondent d'ordinaire.

| | Ce que ça veut dire | Qui agit |
|---|---|---|
| Demande refusée | l'accès n'a jamais existé | le référent, avec un motif communiqué au demandeur |
| Fermeture demandée | un départ ou une mutation est signalé, **l'accès est encore ouvert** | n'importe quel agent ou cadre qui constate le mouvement |
| Habilitation révoquée | l'accès a été fermé dans l'application | le référent de l'application, lui seul |

Une demande de fermeture ne ferme rien par elle-même, et c'est volontaire : tant
que personne n'a agi dans l'application, l'accès existe toujours, et le registre
doit le dire. Elle attend donc dans la file de traitement, à côté des ouvertures,
jusqu'à ce qu'un référent ferme ou refuse en motivant. Le journal garde les deux
temps : qui a demandé la fermeture et pourquoi, puis qui l'a exécutée et quand.

Le délai entre les deux est mesurable, et c'est exactement ce qu'un auditeur
cherche à savoir.

## Le rapprochement avec les applications

Un registre, par construction, ne connaît que ce qu'on lui a déclaré. Un
auditeur le sait, et sa question suivante est toujours la même : « et les accès
que personne n'a déclarés ? ». Le rapprochement y répond.

Menu « Preuves et audit, Rapprochements ». On dépose l'extraction des comptes
d'une application, telle que le logiciel la produit : CSV à point-virgule, à
virgule ou à tabulation, UTF-8 ou ANSI. On indique quelle colonne contient le
matricule, et au besoin le nom, le profil et l'état du compte. L'outil propose
une correspondance d'après les en-têtes et montre un aperçu pour la vérifier.

Deux conditions pour que le constat soit juste :

- **le matricule doit figurer dans l'extraction**. Le registre ne connaît pas
  l'identifiant de connexion propre à chaque logiciel ; le matricule est le
  pivot commun du SIH. Rapprocher sur les noms fabriquerait de faux
  appariements. Si un logiciel ne l'exporte pas, ajoutez-le dans le tableur.
  Les zéros de tête perdus à l'export sont tolérés ;
- **l'extraction doit être complète**. Un compte absent du fichier est compté
  comme absent de l'application.

Cinq constats, rangés par gravité :

| Constat | Ce que ça veut dire | Suite |
|---|---|---|
| Révoqué au registre, encore présent | la fermeture n'a jamais eu lieu dans l'application | noter la fermeture une fois faite |
| Compte non déclaré | un accès que le registre ignore | régulariser, ou fermer dans l'application |
| Déclaré, introuvable | le registre croit l'accès ouvert | révoquer au registre |
| Ouvert sans être enregistré | la demande est en cours, le compte existe déjà | marquer exécutée |
| Concordant | registre et application disent la même chose | rien |

Les suites qui modifient le registre sont réservées au référent de
l'application ; le contrôle constate sans corriger. Chaque suite porte la
référence du rapprochement, si bien qu'un auditeur remonte d'une habilitation
régularisée à l'extraction qui l'a fondée. L'extraction elle-même est conservée
telle quelle, avec son empreinte SHA-256, et se télécharge depuis le
rapprochement. Un constat se corrige tant qu'aucun écart n'a été traité ; après,
il ne se réécrit plus : on dépose une nouvelle extraction.

Un rapprochement par application sensible et par trimestre donne à l'auditeur
une série datée, ce qui vaut mieux qu'un contrôle ponctuel la veille de sa venue.

## Les indicateurs de délai

Menu « Preuves et audit, Indicateurs ». Deux délais, par application :

- **du dépôt à l'ouverture** : ce qu'attend un agent pour obtenir ses accès ;
- **du signalement à la fermeture** : combien de temps l'accès d'un agent parti
  est resté ouvert. C'est le chiffre qu'un contrôle vient chercher.

Chacun est donné en médiane et en « 9 sur 10 en moins de », avec le plus long.
La moyenne est écartée à dessein : une seule demande oubliée trois mois la
fausse, et elle cacherait précisément ce qu'on cherche à voir. Le plus long,
lui, reste affiché pour que l'exception ne disparaisse pas.

Le délai de fermeture est calculé à partir du journal scellé : l'heure du
signalement et celle de la révocation qui l'a soldé. Seules comptent les
révocations qui répondaient à un signalement ; un référent qui ferme de
lui-même n'a rien à mesurer. Un signalement refusé puis refait compte à partir
du second.

La page montre aussi ce qui attend en ce moment, avec l'âge du plus ancien :
un accès signalé à fermer et encore ouvert depuis des semaines est
l'exposition réelle de l'établissement. L'export CSV est au format d'un Excel
français, point-virgule et virgule décimale, et il est tracé au journal.

## La revue périodique des accès

Un auditeur ne se contente pas de la liste des accès : il demande la preuve
qu'ils ont été **réexaminés**, par qui et quand. C'est l'objet du menu
« Revue périodique ».

1. L'administration **ouvre une campagne** (par exemple « Revue annuelle des
   accès 2026 ») avec une échéance. À cet instant, la campagne fige la
   photographie des accès actifs : les accès ouverts après coup relèveront de la
   campagne suivante.
2. Chaque **référent statue sur ses applications** : maintenir ou retirer, avec
   un motif. Un retrait révoque réellement l'habilitation, avec la mention de la
   campagne au journal : une revue sans effet ne prouve rien.
3. L'administration **clôture** la campagne. Ce qui n'a pas été revu reste
   marqué « non revu » : c'est un constat, pas un oubli silencieux.
4. Le **rapport de campagne** (CSV) liste chaque accès, sa décision, son auteur,
   sa date et son motif. C'est la pièce à remettre.

La revue est organisée par application, confiée au référent, parce que c'est le
périmètre que l'outil connaît. Une revue par service supposerait l'organigramme
hiérarchique de l'établissement, que Registris ne détient pas.

## Préparer l'établissement

0. **Partir de la bibliothèque** (« Administration, Bibliothèque ») pour créer
   le catalogue en un geste, puis compléter à la main.
1. **Déclarer les applications** qui comptent pour l'audit (facturation, paie,
   GEF, DPI…) et les regrouper par catégorie.
2. **Nommer les référents** de chaque application et restreindre leur périmètre.
3. **Faire passer les nouvelles demandes par l'outil**, et joindre
   systématiquement le courriel ou le formulaire de demande. Les packs
   « nouvel arrivant » rendent cela rapide.
4. **Reprendre l'existant** progressivement : pour les agents déjà en poste,
   saisir les habilitations en cours avec la date réelle de demande et joindre
   les pièces retrouvées. Le tableau de bord signale les habilitations validées
   sans preuve.
5. **Révoquer à chaque départ**, en indiquant le motif. C'est le point le plus
   souvent relevé par les auditeurs.
6. **Ouvrir une campagne de revue** chaque année, et la clôturer avant la
   période d'audit : le rapport de campagne répond d'avance à la question « qui
   a revérifié ces accès ? ».
7. **Vérifier l'intégrité** (« Preuves et audit, Intégrité du coffre ») avant la
   période d'audit.

## Limites à connaître

- L'outil prouve la **décision** et la **trace**. L'état réel des comptes dans
  chaque application ne se vérifie que par le rapprochement, à partir d'une
  extraction que le logiciel doit fournir ; entre deux rapprochements, le
  registre ne connaît que ce qu'on lui a déclaré.
- La force de la preuve dépend de la discipline de saisie : une habilitation
  ouverte hors de l'outil n'existe pas pour lui.
