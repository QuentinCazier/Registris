# Contribuer

Merci de l'intérêt porté au projet. Les retours de terrain sont ce qui a le
plus de valeur.

## Ce qui aide le plus

- **Retour d'expérience d'établissement** : ce qui a marché, ce qui a bloqué à
  l'installation, ce que les auditeurs ont demandé et que l'outil ne donne pas.
- **Signalement de bug** : la version (`package.json`), le système, les étapes
  pour reproduire, le message d'erreur.
- **Corrections de documentation** : une phrase peu claire pour une DSI ou un
  contrôleur, c'est un ticket légitime.
- **Code** : voir plus bas.

## Règle absolue : aucune donnée réelle

Ne joignez jamais à un ticket ou à une contribution : une base `*.db`, des
pièces de preuve, un export ZIP, une capture d'écran contenant des noms ou
matricules réels, un fichier `.env`. Reproduisez le problème avec la base de
démonstration (`npm run demo`).

## Code

```bash
git clone https://github.com/QuentinCazier/registris.git
cd registris
npm install
npm test
npm run demo && npm start
```

Conventions :

- Node.js 22 ou plus récent, modules ES, pas de transpilation.
- Le code et les commentaires sont en français : c'est le vocabulaire du
  terrain (UF, habilitation, référent, CAC) et le public visé.
- Aucune dépendance native ; réfléchir à deux fois avant d'ajouter une
  dépendance tout court.
- Toute action qui modifie le registre passe par `tracer()` (journal d'audit).
- Toute route qui modifie des données est un `POST` protégé par le jeton CSRF et
  un `exigerDroit(...)`.
- Un test par comportement ajouté ou corrigé, dans `tests/`. La suite doit rester
  verte : `npm test`.
- Pas de tiret cadratin dans le code ni la documentation ; utiliser « : », une
  virgule ou des parenthèses.

Pour une évolution importante, ouvrez d'abord un ticket pour en discuter : le
périmètre volontairement étroit de l'outil (habilitations et preuves) est une
décision de conception.

## Licence des contributions

En contribuant, vous acceptez que votre contribution soit publiée sous la
licence du projet (EUPL-1.2).
