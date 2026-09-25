# Protection des données

Ce document aide l'établissement à inscrire Registris à son registre des
activités de traitement et à en fixer les règles avec son délégué à la
protection des données (DPO). Il décrit ce que fait le logiciel ; les choix
qui reviennent à l'établissement sont signalés comme tels. Ce n'est pas un avis
juridique.

## Fiche pour le registre des traitements

| Rubrique | Contenu |
|---|---|
| Nom du traitement | Gestion et preuve des habilitations aux applications du système d'information |
| Responsable de traitement | L'établissement, représenté par son directeur |
| Finalités | Tracer la demande, la validation, l'ouverture et la fermeture des accès des agents aux applications ; conserver les pièces qui les justifient ; présenter ces preuves aux auditeurs (certification des comptes, contrôle interne) ; revoir périodiquement les accès ; fermer les accès des agents partis |
| Base légale | Obligation légale de sécurité du traitement (article 32 du RGPD) et mission d'intérêt public de l'établissement (article 6.1.e) ; pour les établissements soumis à la certification des comptes, les diligences qu'elle impose sur les accès |
| Personnes concernées | Agents de l'établissement, stagiaires, intérimaires, prestataires disposant d'un accès ; utilisateurs de Registris |
| Données | Identité professionnelle : matricule, nom, prénom, courriel professionnel. Vie professionnelle : unités fonctionnelles, site, profils d'accès demandés et accordés, dates. Pièces justificatives : courriels de demande, captures, PDF. Journal : actions, horodatage, identifiant de connexion, adresse IP à la connexion |
| Données sensibles | Aucune donnée de santé, aucun NIR, aucune donnée au sens de l'article 9 |
| Destinataires | Référents applicatifs pour leurs applications, administrateurs de l'outil, contrôle interne, commissaires aux comptes et auditeurs sur le dossier de preuves ; l'agent pour ses propres demandes ; les outils autorisés par un jeton d'API |
| Transferts hors UE | Aucun : l'outil est installé sur un serveur de l'établissement et n'appelle aucun service extérieur |
| Durées de conservation | Voir ci-dessous ; à arrêter par l'établissement |
| Mesures de sécurité | Voir ci-dessous et [SECURITY.md](../SECURITY.md) |

## Durées de conservation

| Données | Durée | Mécanisme |
|---|---|---|
| Accès en cours et leurs pièces | tant que l'accès existe | aucun effacement |
| Identité d'un agent dont tous les accès sont clos, et ses pièces | `CONSERVATION_ANNEES` après la clôture du dernier accès, 5 ans par défaut | `registris purger` : nom, prénom, courriel et matricule remplacés par « Anonymisé », commentaires effacés, fichiers des pièces supprimés |
| Comptes de l'annuaire vus à la connexion | même durée depuis la dernière connexion | `registris purger` |
| Départs détectés traités | même durée | `registris purger` |
| Sessions | durée de la session (8 heures par défaut) | purge automatique toutes les heures |
| Journal d'audit | durée de vie de la base | voir la limite ci-dessous |
| Sauvegardes | politique de l'établissement | hors de Registris |

La durée par défaut couvre un cycle complet de certification des comptes et
les contrôles de l'exercice suivant. L'établissement la fixe avec son DPO et
son commissaire aux comptes, puis la règle dans la configuration :

```ini
CONSERVATION_ANNEES=5
```

La purge se lance à la main ou par une tâche planifiée, de préférence après la
sauvegarde de la nuit. Elle se simule d'abord :

```bash
registris purger --simuler
registris purger
```

Chaque purge est inscrite au journal d'audit avec son bilan. Une pièce purgée
reste listée dans la fiche avec la mention « supprimée, durée de conservation
atteinte » : on sait qu'elle a existé, on ne peut plus la lire.

**Limite assumée : le journal d'audit n'est pas purgé.** Chaque écriture scelle
la précédente ; en retirer une briserait la preuve de tout ce qui suit. Le
journal garde donc les identifiants de connexion et les matricules cités dans
les détails des opérations. Il n'est lisible que par les administrateurs et le
contrôle. Pour s'en séparer au terme de la durée d'archivage, l'établissement
archive la base entière (`registris sauvegarder`) et en démarre une nouvelle.

## Droits des personnes

- **Accès** : un agent voit ses demandes dans « Mes demandes ». Pour une
  demande formelle, un référent ou l'administrateur produit la liste de ses
  accès par la recherche d'agent, ou un dossier complet par « Preuves et
  audit ».
- **Rectification** : une identité erronée se corrige aujourd'hui en base par
  la DSI ; les profils et les dates se corrigent dans la fiche par le référent,
  et la correction est tracée.
- **Effacement et opposition** : limités tant que la conservation répond à
  l'obligation de sécurité et de preuve ; l'effacement intervient au terme de
  la durée fixée.
- **Limitation, portabilité** : sans objet pour ce traitement.

## Information des agents

Modèle de mention, à adapter et à diffuser par l'intranet ou la charte
informatique :

> Vos demandes d'accès aux applications de l'établissement, leur validation,
> leur ouverture et leur fermeture sont enregistrées dans le registre des
> habilitations, avec les pièces qui les justifient. Ce registre sert à la
> sécurité du système d'information et aux contrôles des auditeurs. Il est
> conservé [durée] après la fermeture de votre dernier accès. Vous pouvez
> consulter vos demandes dans l'outil et exercer vos droits auprès du délégué à
> la protection des données : [adresse].

## Analyse d'impact

Les lignes directrices européennes et la liste de la CNIL demandent une
analyse d'impact quand un traitement réunit au moins deux critères de risque.
Registris, seul, n'en réunit a priori aucun de façon franche : pas de donnée
sensible, pas d'évaluation ni de notation des personnes, pas de décision
automatique, pas de croisement avec d'autres fichiers hors du rapprochement
ponctuel qu'un référent déclenche, des personnes concernées qui sont des
agents, pas des personnes vulnérables. Le critère de surveillance systématique
se discute : le journal trace les actions des utilisateurs de l'outil, pas
l'activité des agents dans leurs applications. La décision revient au DPO ;
cette analyse et la présente fiche en sont le point de départ.

## Mesures de sécurité

- Installation sur un serveur de l'établissement, aucun appel sortant, HTTPS.
- Authentification par l'Active Directory, blocage après cinq échecs, sessions
  expirées côté serveur.
- Droits par rôle, référents limités à leurs applications, agents limités à
  leurs propres demandes.
- Journal d'audit chaîné, ancrage externe de sa tête, contrôle quotidien.
- Pièces vérifiées par empreinte, types de fichiers contrôlés à la signature.
- Sauvegarde avec manifeste d'empreintes, restauration contrôlée.
- API en lecture seule, un jeton révocable par outil.
- Aucune donnée patient.

## Sous-traitance

Installé par la DSI sur ses serveurs, Registris n'implique aucun sous-traitant.
Si l'établissement le fait héberger par un tiers, un groupement ou un
infogéreur, ce tiers devient sous-traitant et le contrat doit comporter les
clauses de l'article 28 du RGPD.
