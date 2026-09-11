# Ressources de marque (public/)

Ce dossier est servi tel quel à la racine du site. Il contient par défaut le
logo de Registris (`logo.png`, `favicon.ico`, `apple-touch-icon.png`), utilisé
dans la barre latérale, la page de connexion et l'onglet du navigateur.
Remplacez ces fichiers par ceux de votre établissement pour personnaliser
l'interface ; supprimez-les pour revenir au pictogramme « clé » intégré.

| Fichier | Usage | Recommandation |
|---|---|---|
| `logo.svg` (ou `logo.png`, `logo.webp`) | Barre latérale, page de connexion | Carré, angles arrondis ; SVG idéal, sinon PNG 512×512 |
| `favicon.ico` (ou `favicon.png`) | Onglet du navigateur | 32×32 et 16×16 |
| `apple-touch-icon.png` | Icône d'écran d'accueil | 180×180, sans transparence |

Le titre affiché (nom de l'établissement) se règle avec `NOM_ETABLISSEMENT` dans `.env`.
