# Signature de l'installateur Windows

Tant que l'installateur n'est pas signé par un certificat d'éditeur, Windows
SmartScreen affiche « Windows a protégé votre ordinateur » au premier
lancement. Beaucoup de DSI bloquent les exécutables non signés par stratégie de
groupe. La signature supprime cet obstacle.

[SignPath Foundation](https://signpath.org) signe gratuitement les logiciels
libres. Le certificat est émis au nom de la fondation, qui vérifie que
l'exécutable est construit par l'intégration continue à partir du dépôt public,
sans intervention manuelle.

## Mise en place, une seule fois

0. Prérequis de la fondation : licence approuvée par l'OSI (EUPL-1.2, en
   place), projet déjà publié (en place), désinstallation possible et nom et
   version du produit dans l'exécutable (en place), authentification à deux
   facteurs sur GitHub et SignPath, et une section « Politique de signature du
   code » sur la page du projet : mention « Free code signing provided by
   SignPath.io, certificate by SignPath Foundation », rôles de l'équipe,
   engagement de confidentialité. Cette section n'est à publier qu'une fois la
   candidature acceptée, pour ne pas annoncer une signature qui n'existe pas.
1. Déposer la candidature sur <https://signpath.org/apply> : dépôt
   `QuentinCazier/Registris`, licence EUPL-1.2, un seul fichier à signer,
   l'installateur produit par `.github/workflows/installateur-windows.yml`.
2. Une fois le projet accepté, créer dans SignPath :
   - le projet `registris` ;
   - la politique de signature `release-signing` ;
   - un jeton d'API pour un utilisateur de type CI.
3. Dans le dépôt GitHub, « Settings, Secrets and variables, Actions », ajouter :
   - `SIGNPATH_API_TOKEN` : le jeton d'API ;
   - `SIGNPATH_ORGANIZATION_ID` : l'identifiant de l'organisation SignPath.
4. Dans « Settings, Actions, General », autoriser l'action
   `signpath/github-action-submit-signing-request@*` : le dépôt n'accepte
   aujourd'hui que les actions de GitHub et des éditeurs vérifiés.

## Ce que fait le workflow

Dès que le secret `SIGNPATH_API_TOKEN` existe, le workflow de l'installateur :

1. compile l'installateur ;
2. le transmet à SignPath et attend la signature ;
3. remplace le fichier par sa version signée et vérifie la signature
   Authenticode ;
4. calcule les sommes SHA-256 sur le fichier signé ;
5. installe, met à jour et désinstalle l'exécutable signé sur l'exécuteur
   Windows, comme aujourd'hui.

Sans le secret, ces étapes sont sautées et l'installateur reste non signé, ce
qui permet aux contributeurs de construire leurs propres versions.

## Vérifier une signature

```powershell
Get-AuthenticodeSignature .\registris-1.0.0-installateur.exe | Format-List Status, SignerCertificate
```
