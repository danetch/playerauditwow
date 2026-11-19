/**
 * Sheets.gs — écriture dans Historique (une ligne par joueur et par semaine) et Tableau (semaine en cours).
 */

const HISTORY_HEADERS = [
  'Semaine', 'Début semaine', 'Joueur', 'Royaume', 'Classe', 'Rôle',
  'Présence %', 'Pts présence', 'ilvl', 'Coffre slot 2', 'Coffre slot 3', 'Pts équipement',
  'Perf WCL', 'Pts perf', 'Pulls', 'Morts', 'Morts/pull', 'Pts survie',
  'Total /100', 'Remarques', 'Mis à jour',
];

const COL = { period: 0, name: 2, realm: 3, total: 18 };

function getOrCreateSheet_(name, headers) {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Remplace les lignes de la semaine (plus de doublons comme avec appendRow). */
function upsertHistory_(period, rows) {
  const sheet = getOrCreateSheet_(SHEETS.history, HISTORY_HEADERS);
  const last = sheet.getLastRow();
  const existing = last > 1 ? sheet.getRange(2, 1, last - 1, HISTORY_HEADERS.length).getValues() : [];
  const kept = existing.filter(function (r) { return Number(r[COL.period]) !== period; });
  const all = kept.concat(rows);
  if (last > 1) sheet.getRange(2, 1, last - 1, HISTORY_HEADERS.length).clearContent();
  if (all.length) sheet.getRange(2, 1, all.length, HISTORY_HEADERS.length).setValues(all);
}

/** Totaux d'une semaine passée, par personnage. */
function getHistoryTotals_(period) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.history);
  const out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, HISTORY_HEADERS.length).getValues().forEach(function (r) {
    if (Number(r[COL.period]) === period) out[charKey_(r[COL.name], r[COL.realm])] = r[COL.total];
  });
  return out;
}

function writeBoard_(period, rows, lastRaid) {
  const headers = ['Joueur', 'Rôle', 'Total /100', 'Semaine précédente', 'Évolution',
    'Pts présence', 'Pts équipement', 'Pts perf', 'Pts survie', 'Pulls', 'Morts', 'Remarques'];
  const prev = getHistoryTotals_(period - 1);

  const lines = rows.map(function (r) {
    const before = prev[charKey_(r[COL.name], r[COL.realm])];
    const total = r[COL.total];
    const delta = total !== '' && before !== '' && before != null ? total - before : '';
    return [r[2], r[5], total, before == null ? '' : before, delta, r[7], r[11], r[13], r[17], r[14], r[15], r[19]];
  }).sort(function (a, b) {
    return (b[2] === '' ? -1 : b[2]) - (a[2] === '' ? -1 : a[2]);
  });

  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEETS.board) || ss.insertSheet(SHEETS.board);
  sheet.clearContents();
  const title = 'Semaine ' + period + (lastRaid ? ' — dernier raid pris en compte : ' +
    Utilities.formatDate(lastRaid, TZ, 'dd/MM/yyyy HH:mm') : '');
  sheet.getRange(1, 1).setValue(title).setFontWeight('bold');
  sheet.getRange(2, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (lines.length) sheet.getRange(3, 1, lines.length, headers.length).setValues(lines);
  sheet.setFrozenRows(2);
}
