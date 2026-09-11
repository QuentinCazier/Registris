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
- **Pièces empreintées** : une pièce modifiée après son dépôt est signalée
  « altérée » dans l'application et dans le dossier exporté.
- **Séparation des rôles** : le demandeur ne valide pas, le référent ne valide
  que ses applications, le contrôleur lit et exporte sans pouvoir modifier.
- **Historique par habilitation** : sur chaque fiche, la liste horodatée de qui
  a fait quoi.

## Préparer l'établissement

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
6. **Vérifier l'intégrité** (« Audit, Intégrité du coffre ») avant la période
   d'audit.

## Limites à connaître

- L'outil prouve la **décision** et la **trace**, pas l'état réel des comptes
  dans chaque application. La revue périodique des comptes réels (export des
  utilisateurs de chaque logiciel, rapprochement avec le registre) reste à faire
  et pourra faire l'objet d'une évolution.
- La force de la preuve dépend de la discipline de saisie : une habilitation
  ouverte hors de l'outil n'existe pas pour lui.
