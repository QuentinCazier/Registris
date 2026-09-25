# API en lecture

Registris expose une API JSON en lecture seule pour les outils de
l'établissement : GLPI, la supervision, un script de contrôle. Elle ne permet
de rien créer ni modifier : une demande passe toujours par l'écran, où elle est
tracée et justifiée.

## Jeton

L'administrateur crée un jeton par outil dans « Administration, API ». Le jeton
n'est affiché qu'une fois, à sa création ; la base n'en garde que l'empreinte.
Il se révoque à tout moment depuis la même page, qui montre aussi la date du
dernier appel et le nombre d'appels. La création et la révocation sont inscrites
au journal d'audit.

Chaque appel porte le jeton dans l'en-tête `Authorization` :

```bash
curl -H "Authorization: Bearer rgs_..." https://registris.etablissement.local/api/v1/demandes
```

```powershell
$h = @{ Authorization = 'Bearer rgs_...' }
Invoke-RestMethod -Headers $h https://registris.etablissement.local/api/v1/demandes
```

Sans jeton valide, la réponse est `401`. Toute méthode autre que `GET` reçoit
`405`. L'API ne pose aucun cookie et ses réponses ne sont pas mises en cache.

## Points d'accès

| Chemin | Rend |
|---|---|
| `GET /api/v1/demandes` | la file : demandes à valider ou à ouvrir, fermetures demandées |
| `GET /api/v1/habilitations` | tout le registre, filtrable et paginé |
| `GET /api/v1/agents/{matricule}/acces` | les accès d'un agent, en cours ou ouverts ; `?tous=1` ajoute les clos |
| `GET /api/v1/applications` | le catalogue, avec le nombre d'accès ouverts par application |

Filtres de `/demandes` et `/habilitations` :

| Paramètre | Exemple | Effet |
|---|---|---|
| `application` | `GAM` | code de l'application |
| `etat` | `ouverte` | `demandee`, `validee`, `ouverte`, `fermee` ou `refusee` (`/habilitations` seulement) |
| `modifie_depuis` | `2026-10-01` | modifiées depuis cette date, pour une synchronisation (`/habilitations` seulement) |
| `limite` | `200` | taille de page, 100 par défaut, 500 au plus |
| `apres` | `1843` | curseur : l'identifiant `suivant` de la page précédente |

## Réponse

```json
{
  "habilitations": [
    {
      "id": 1843,
      "agent": { "matricule": "E45678", "nom": "Petit", "prenom": "Claire" },
      "application": { "code": "GAM", "libelle": "Gestion administrative des malades" },
      "profil": "Gestionnaire admissions",
      "etat": "ouverte",
      "fermeture_demandee": null,
      "accord_cadre": null,
      "ufs": ["9001"],
      "date_fin": "2026-12-31",
      "dates": {
        "demande": "2026-09-25", "validation": "2026-09-26", "ouverture": "2026-09-26",
        "fermeture": null, "refus": null, "modification": "2026-09-26 08:14:02"
      },
      "prise_en_charge": "pdurand",
      "pieces": 2
    }
  ],
  "suivant": 1843
}
```

`suivant` vaut `null` sur la dernière page. Pour tout parcourir :

```powershell
$apres = 0
do {
  $page = Invoke-RestMethod -Headers $h "https://registris.etablissement.local/api/v1/habilitations?limite=500&apres=$apres"
  $page.habilitations | ForEach-Object { $_.id }
  $apres = $page.suivant
} while ($apres)
```

Les erreurs rendent un objet `{ "erreur": "..." }` avec le code `400` (paramètre
invalide), `401`, `404` ou `405`.

## Exemples d'usage

- **GLPI** : une règle de collecte lit `/api/v1/demandes` et ouvre un ticket
  par demande en attente depuis plus de deux jours.
- **Supervision** : une sonde compte les éléments de `/api/v1/demandes` et
  alerte au-delà d'un seuil ; `/sante` reste la sonde de disponibilité.
- **Contrôle** : un script compare `/api/v1/agents/{matricule}/acces` à
  l'annuaire ou au fichier de paie.

## Sécurité

- Un jeton donne la lecture de tout le registre : qui détient quel accès. Le
  traiter comme un mot de passe de compte de service, un par outil, révoqué au
  moindre doute.
- Servir l'API en HTTPS, comme l'application.
- Les appels ne sont pas inscrits un par un au journal d'audit, pour ne pas le
  noyer sous les sondes ; la page des jetons garde le dernier appel et le
  compte.
