# Accessibilité

Ce document dit ce qui a été vérifié, comment, et surtout **ce qui ne l'a pas
été**. Il ne vaut pas déclaration de conformité : celle-ci appartient à
l'établissement qui déploie l'outil, et suppose un audit dans les règles.

## Qui est concerné

L'obligation d'accessibilité découle de l'article 47 de la loi n° 2005-102 du
11 février 2005 et du décret n° 2019-768 du 24 juillet 2019. Elle pèse sur les
**personnes morales de droit public**, donc sur l'établissement public de santé
qui met le service à disposition de ses agents, et non sur l'auteur du logiciel.

L'établissement ne peut toutefois tenir cette obligation que si l'outil s'y
prête. C'est l'objet de ce qui suit.

Référentiel applicable : **RGAA 4.1.2**, fondé sur WCAG 2.1 niveau AA (état
vérifié le 18 septembre 2026 ; une version 5 du référentiel, alignée sur
WCAG 2.2, est annoncée pour fin 2026). Les critères de WCAG 2.2 qui touchent
directement cette interface, notamment la taille minimale des cibles, sont déjà
respectés.

## Ce qui est vérifié automatiquement, à chaque exécution des tests

Le fichier `tests/accessibilite.test.js` parcourt toutes les pages de
l'application (vingt-sept à ce jour), authentifié, et vérifie :

| Contrôle | Critères RGAA visés |
|---|---|
| langue de la page déclarée | 8.3 |
| titre de page explicite et unique | 8.5, 8.6 |
| un seul titre de niveau 1, hiérarchie sans saut de niveau | 9.1 |
| chaque champ de formulaire porte une étiquette, explicite ou englobante | 11.1, 11.2 |
| chaque tableau de données porte une légende et des en-têtes à portée déclarée | 5.4 à 5.7 |
| chaque image porte une alternative, chaque lien un intitulé | 1.1, 6.1 |
| lien d'évitement en tête de page, repères `main` et `nav` nommés | 12.7, 9.2 |
| page courante signalée par `aria-current`, pas seulement par la couleur | 3.1 |
| statut toujours accompagné de son libellé | 3.1 |
| contrastes de la palette, y compris texte secondaire et fonds colorés | 3.2, 3.3 |
| couleur d'établissement : lisibilité garantie quelle que soit la teinte | 3.2 |
| hauteur de cible des boutons, prise de focus visible | 10.7, cible 24 px de WCAG 2.2 |

```bash
npm test                       # l'ensemble de la suite
node --test tests/accessibilite.test.js   # ces seuls contrôles
```

Les couleurs testées sont lues **dans la feuille de style elle-même** : le test
ne peut pas se désynchroniser du code.

## Ce que ces contrôles ont corrigé

Ils n'ont pas été écrits pour confirmer un état satisfaisant, mais pour le
mesurer. Ils ont trouvé, et fait corriger :

- le gris du texte secondaire (dates, matricules, aides de saisie) était à un
  contraste de 3,65 pour 1, sous le seuil de 4,5 ; il est passé à 4,74 ;
- la couleur configurable de l'établissement servait aussi de couleur de texte
  pour les liens : une teinte pâle aurait produit des liens illisibles. Une
  nuance dérivée, assombrie juste ce qu'il faut, est désormais calculée pour le
  texte, l'aplat gardant la couleur choisie ;
- douze tableaux sur dix-sept n'avaient pas de légende, et soixante-quinze
  en-têtes de colonne n'avaient pas de portée déclarée ;
- la boîte de traitement vide ne comportait aucun titre de niveau 1.

## Ce qui n'a pas été vérifié

Cette liste est aussi importante que la précédente.

- **Aucun audit par un tiers n'a été réalisé.** Il n'existe donc **aucun taux de
  conformité** opposable, et ce document ne doit pas être présenté comme tel.
- **Aucun test avec un lecteur d'écran** (NVDA, JAWS, VoiceOver). L'ordre de
  lecture, la restitution des tableaux et des messages d'erreur doivent être
  éprouvés par une personne qui utilise ces outils au quotidien.
- **Aucun test de navigation au clavier de bout en bout** sur des parcours
  complets, ni de recherche de piège au clavier.
- **Aucun test de zoom à 200 %, de réduction de la fenêtre à 320 px**, ni de
  restitution en mode contrastes forcés de Windows.
- **Aucun test avec des personnes en situation de handicap.**
- Les **documents produits** (dossier de preuves ZIP, synthèse HTML, exports CSV)
  n'ont pas été évalués.
- Les **contenus saisis par l'établissement** (libellés d'applications, motifs)
  échappent par nature à tout contrôle de l'outil.

## Points d'attention connus

- **Tableaux larges.** Le registre comporte jusqu'à neuf colonnes. Sur écran
  étroit, le tableau défile horizontalement dans son cadre ; cette solution est
  courante mais reste inconfortable au clavier. Une présentation en liste sous
  une certaine largeur serait préférable.
- **Couleur de l'établissement.** L'outil garantit le contraste du texte posé
  sur la couleur et de la couleur employée en texte. Il ne peut rien contre un
  logo illisible déposé dans `public/`.
- **Densité.** L'interface est dense par choix, parce qu'elle sert à traiter des
  listes. La taille de police de base est de 14 px, et tout est exprimé en
  unités relatives : le zoom du navigateur fonctionne, mais un audit devra
  confirmer le comportement à 200 %.
- **Aucun script bloquant.** L'application fonctionne sans JavaScript, à
  l'exception d'une confirmation avant les actions destructrices. Rien ne dépend
  d'un pointeur ou d'un survol.

## Modèle de déclaration pour l'établissement

À compléter, publier sur une page accessible depuis toutes les pages du service
et signaler à l'autorité compétente. **Les taux et dates sont à renseigner après
un audit réel.**

> ### Déclaration d'accessibilité
>
> [Nom de l'établissement] s'engage à rendre son service accessible,
> conformément à l'article 47 de la loi n° 2005-102 du 11 février 2005.
>
> Cette déclaration s'applique à **Registris**, registre des habilitations,
> accessible à l'adresse [adresse interne].
>
> **État de conformité** : [non conforme / partiellement conforme / totalement
> conforme] au référentiel général d'amélioration de l'accessibilité (RGAA),
> version [4.1.2], à hauteur de [X] % des critères applicables.
>
> **Résultats des tests** : l'audit de conformité réalisé le [date] par
> [auditeur] révèle que [X] % des critères sont respectés.
>
> **Contenus non accessibles** : [liste des non-conformités, des dérogations
> pour charge disproportionnée et des contenus non soumis].
>
> **Établissement de cette déclaration** : le [date], à partir de [audit
> externe / auto-évaluation], avec [outils utilisés].
>
> **Retour d'information et contact** : [adresse de contact]. En cas d'absence
> de réponse, vous pouvez saisir le Défenseur des droits.

L'établissement doit également publier un **schéma pluriannuel de mise en
accessibilité** et son **plan d'action annuel**.

## Refaire les contrôles après une modification

Les contrôles automatiques font partie de la suite de tests : une régression
casse le test, pas seulement l'expérience d'un utilisateur. Pour un audit
complet, prévoir en plus un parcours au lecteur d'écran et un test clavier sur
les trois écrans qui portent le travail : la boîte de traitement, le registre et
la fiche d'habilitation.
