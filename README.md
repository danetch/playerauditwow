# playerauditwow

Notation hebdomadaire des joueurs de raid de la guilde, en Google Apps Script, branchée sur une Google Spreadsheet.

Chaque nuit, le script récupère les raids de la semaine WoW en cours (du reset du mercredi au mardi) et note chaque joueur sur 100 :

| Indicateur | Source | Poids par défaut |
|---|---|---|
| Présence | WowAudit (`v1/attendance`, % depuis le début de saison) | 20 |
| Équipement | WowAudit : coffre M+ de la semaine précédente + ilvl du meilleur équipement | 20 |
| Perf | Warcraft Logs (`zoneRankings`, meilleur entre classement par tranche d'ilvl et général) | 30 |
| Survie | Warcraft Logs : morts par pull sur la semaine, comparées à la moyenne du raid | 30 |

Une note sans donnée reste vide ; le total est ramené sur 100 avec les notes disponibles.

## Structure

```
src/
  Main.gs       points d'entrée : dailyRun, forceRun, installTriggers
  Config.gs     lecture de l'onglet Settings, utilitaires
  Api.gs        HTTP, tokens WCL / Battle.net en cache, appels parallèles
  WowAudit.gs   roster, présence, coffre, ilvl
  Wcl.gs        rapports de la semaine, pulls / morts, perf
  Scoring.gs    calcul des points
  Sheets.gs     écriture dans Historique et Tableau
  appsscript.json
legacy/
  codeappscript.gs   ancienne version, pour référence (non déployée)
```

## Onglets de la spreadsheet

- **Settings** : réglages, en-têtes en ligne 1 et valeurs en ligne 2 (lancer `setupSettings()` pour ajouter les colonnes manquantes).
- **Historique** : une ligne par joueur et par semaine, remplacée à chaque recalcul de la semaine.
- **Tableau** : la semaine en cours, triée par note, avec l'évolution par rapport à la semaine précédente.

## Mise en place

1. Propriétés du script : `WA_SECRET`, `WCL_ID`, `WCL_SECRET`, `BNET_ID`, `BNET_SECRET`.
2. `setupSettings()`, puis ajuster les valeurs dans l'onglet Settings.
3. `forceRun()` pour vérifier, puis `installTriggers()` (déclencheur quotidien à 1 h, heure de Paris).

## Déploiement

Chaque modification de `src/` fusionnée dans `main` est envoyée automatiquement dans le projet Apps Script par la GitHub Action `.github/workflows/deploy.yml` (`clasp push`). On peut aussi la lancer à la main depuis l'onglet Actions (« Run workflow »).

- `.clasp.json` contient l'ID du script (pas un secret).
- Le secret GitHub `CLASPRC_JSON` contient le fichier `~/.clasprc.json` obtenu avec `clasp login` (clasp 3). Ne jamais le commiter.
- `clasp push` remplace tout le code du projet Apps Script par `src/`, manifeste `appsscript.json` compris.

Pour déployer depuis un poste local : `npm install -g @google/clasp`, `clasp login`, puis `clasp push` à la racine du dépôt.
