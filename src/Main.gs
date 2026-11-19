/**
 * Main.gs — points d'entrée.
 *
 * Mise en place (une fois) :
 *   1. Ajouter les propriétés de script WA_SECRET, WCL_ID, WCL_SECRET, BNET_ID, BNET_SECRET.
 *   2. Lancer setupSettings() : ajoute les colonnes manquantes à droite de l'onglet Settings,
 *      puis ajuster leurs valeurs (jours de raid, poids...).
 *   3. Lancer forceRun() pour vérifier, puis installTriggers().
 *   4. Supprimer l'ancien déclencheur sur startProcessing.
 *
 * Fonctionnement : chaque nuit, on regarde les raids de la semaine WoW en cours
 * (reset du mercredi -> mardi). S'il y a du nouveau, on recalcule toute la semaine et on
 * remplace ses lignes dans Historique. Après le reset, la semaine précédente reste figée.
 */

function dailyRun() { run_(false); }

/** Recalcule même si aucun nouveau log n'est apparu (après un changement dans Settings par exemple). */
function forceRun() { run_(true); }

function run_(force) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) { Logger.log('Un autre run est en cours.'); return; }
  try {
    const cfg = getConfig();
    const period = getWaCurrentPeriod_();
    const bounds = getPeriodBounds_(period);
    const raids = getWeekRaids_(cfg, bounds);

    if (!raids.reports.length) {
      const fmt = function (d) { return Utilities.formatDate(d, TZ, 'EEE dd/MM HH:mm'); };
      Logger.log('Aucun raid logué cette semaine (' + fmt(bounds.start) + ' -> ' + fmt(bounds.end) + ', heure de Paris).');
      return;
    }
    const props = PropertiesService.getScriptProperties();
    const sigKey = 'signature_' + period;
    if (!force && props.getProperty(sigKey) === raids.signature) {
      Logger.log('Pas de nouveau log depuis le dernier calcul.');
      return;
    }

    const roster = getWaRoster_();
    const data = {
      period: period,
      bounds: bounds,
      roster: roster,
      raids: raids,
      attendance: getWaAttendance_(cfg.seasonStart || detectSeasonStart_()),
      vault: getWaVault_(period - 1), // coffre issu des donjons de la semaine précédente
      ilvls: getWaIlvls_(roster),
      perf: getWclPerf_(cfg, roster, raids.difficulty),
    };

    const rows = computeWeek_(cfg, data);
    upsertHistory_(period, rows);
    writeBoard_(period, rows, raids.lastReportTime);
    props.setProperty(sigKey, raids.signature);
    Logger.log(rows.length + ' joueurs notés pour la semaine ' + period + ' (' + raids.reports.length + ' soirées).');
  } finally {
    lock.releaseLock();
  }
}

/** Installe le déclencheur quotidien vers 1 h (et supprime les doublons). */
function installTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'dailyRun'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyRun').timeBased().everyDays(1).atHour(1).inTimezone(TZ).create();
}
