# Ressources de marque (public/)

Ce dossier est servi tel quel à la racine du site. Il contient par défaut la
marque de Registris et les polices de l'interface. Remplacez les fichiers par
ceux de votre établissement pour personnaliser l'interface ; supprimez-les pour
revenir au pictogramme intégré.

| Fichier | Usage | Recommandation |
|---|---|---|
| `marque.svg` (ou `marque.png`) | Barre haute, à 26 px | Deux formes, deux couleurs au maximum. Un logo chargé de détails devient une tache à cette taille. |
| `logo.svg` (ou `logo.png`, `logo.webp`) | Page de connexion, en grand | Carré, angles arrondis ; SVG idéal, sinon PNG 512×512. Sert aussi de repli pour la barre haute si `marque.svg` est absent. |
| `favicon.ico` (ou `favicon.png`) | Onglet du navigateur | 32×32 et 16×16 |
| `apple-touch-icon.png` | Icône d'écran d'accueil | 180×180, sans transparence |
| `polices/` | Interface | Atkinson Hyperlegible Next et sa compagne en chasse fixe, sous licence SIL Open Font (voir `polices/LICENSE.txt`). Auto-hébergées : aucune requête vers un service extérieur. |

Deux réglages complètent la marque, dans le fichier `.env` :

- `NOM_ETABLISSEMENT` : le nom affiché à côté de la marque et dans les exports.
- `COULEUR_ACCENT` : la couleur de l'établissement, au format hexadécimal. Elle
  habille la barre haute, les boutons, les liens et l'onglet actif. Les nuances
  de survol et de fond, ainsi que la couleur du texte posé dessus, en sont
  déduites automatiquement pour rester lisibles. Les couleurs de statut
  (attente, active, close, anomalie) ne changent pas : elles gardent le même
  sens d'un établissement à l'autre.

## Pourquoi cette police

Atkinson Hyperlegible est dessinée par le Braille Institute pour lever les
confusions entre caractères proches : le zéro et la lettre O, le 1 et le l
minuscule, le 8 et le B. Sur un outil rempli de matricules, de numéros d'UF et
d'empreintes SHA-256, lu par des agents de tous âges, la distinction compte.
Les deux fichiers pèsent 52 Ko au total.
