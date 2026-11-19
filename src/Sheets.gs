/**
 * Sheets.gs — écriture dans Historique (une ligne par joueur et par semaine) et Tableau (semaine en cours).
 * Les colonnes sont repérées par leur nom : en ajouter une ne décale rien.
 */

const HISTORY_HEADERS = [
  'Semaine', 'Début semaine', 'Joueur', 'Royaume', 'Classe', 'Rôle',
  'Présence %', 'Pts présence', 'ilvl', 'Coffre slot 2', 'Coffre slot 3', 'Pts équipement',
  'Perf semaine', 'Kills classés', 'Pts perf', 'Perf saison (info)',
  'Pulls', 'Morts', 'Morts/pull', 'Pts survie',
  'Total /100', 'Remarques', 'Mis à jour',
];

const BOARD_HEADERS = [
  'Joueur', 'Rôle', 'Total /100', 'Semaine précédente', 'Évolution',
  'Pts présence', 'Pts équipement', 'Pts perf', 'Pts survie',
  'Perf semaine', 'Perf saison (info)', 'Pulls', 'Morts', 'Remarques',
];

/** Lit Historique en objets indexés par nom de colonne. */
function readHistory_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.history);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  return values.slice(1).map(function (r) {
    const o = {};
    headers.forEach(function (h, i) { if (h !== '') o[h] = r[i]; });
    return o;
  });
}

/** Remplace les lignes de la semaine (pas de doublons). */
function upsertHistory_(period, rows) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEETS.history) || ss.insertSheet(SHEETS.history);
  const kept = readHistory_().filter(function (o) { return Number(o['Semaine']) !== period; });
  const all = kept.concat(rows).map(function (o) {
    return HISTORY_HEADERS.map(function (h) { return o[h] === undefined ? '' : o[h]; });
  });
  sheet.clearContents();
  sheet.getRange(1, 1, 1, HISTORY_HEADERS.length).setValues([HISTORY_HEADERS]).setFontWeight('bold');
  if (all.length) sheet.getRange(2, 1, all.length, HISTORY_HEADERS.length).setValues(all);
  sheet.setFrozenRows(1);
}

function writeBoard_(period, rows, lastRaid) {
  const prev = {};
  readHistory_().forEach(function (o) {
    if (Number(o['Semaine']) === period - 1) prev[charKey_(o['Joueur'], o['Royaume'])] = o['Total /100'];
  });

  const lines = rows.map(function (o) {
    const before = prev[charKey_(o['Joueur'], o['Royaume'])];
    const total = o['Total /100'];
    const hasBefore = before !== undefined && before !== '';
    const line = Object.assign({}, o, {
      'Semaine précédente': hasBefore ? before : '',
      'Évolution': total !== '' && hasBefore ? total - before : '',
    });
    return BOARD_HEADERS.map(function (h) { return line[h] === undefined ? '' : line[h]; });
  }).sort(function (a, b) {
    const t = BOARD_HEADERS.indexOf('Total /100');
    return (b[t] === '' ? -1 : b[t]) - (a[t] === '' ? -1 : a[t]);
  });

  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEETS.board) || ss.insertSheet(SHEETS.board);
  sheet.clearContents();
  const title = 'Semaine ' + period + (lastRaid ? ' — dernier raid pris en compte : ' +
    Utilities.formatDate(lastRaid, TZ, 'dd/MM/yyyy HH:mm') : '');
  sheet.getRange(1, 1).setValue(title).setFontWeight('bold');
  sheet.getRange(2, 1, 1, BOARD_HEADERS.length).setValues([BOARD_HEADERS]).setFontWeight('bold');
  if (lines.length) sheet.getRange(3, 1, lines.length, BOARD_HEADERS.length).setValues(lines);
  sheet.setFrozenRows(2);
}
