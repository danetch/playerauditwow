/**
 * Config.gs — paramètres lus depuis l'onglet "Settings" + secrets dans les Script Properties.
 *
 * Secrets à créer une fois dans Paramètres du projet > Propriétés du script :
 *   WA_SECRET, WCL_ID, WCL_SECRET, BNET_ID, BNET_SECRET
 */

const TZ = 'Europe/Paris';

const URLS = {
  wowAudit: 'https://wowaudit.com/',
  wcl: 'https://www.warcraftlogs.com/api/v2/client',
  wclAuth: 'https://www.warcraftlogs.com/oauth/token',
  bnet: 'https://eu.api.blizzard.com/',
  bnetAuth: 'https://oauth.battle.net/token',
};

const SHEETS = { settings: 'Settings', history: 'Historique', board: 'Tableau' };

/**
 * Colonnes lues dans l'onglet Settings (ligne 1 = en-têtes, ligne 2 = valeurs).
 * Les 5 premières existent déjà dans ta feuille ; les autres sont ajoutées par setupSettings().
 * [en-tête, clé, valeur par défaut, description]
 */
const SETTINGS_COLUMNS = [
  ['guild id', 'guildId', '', "ID WCL de la guilde (dans l'URL warcraftlogs.com/guild/id/XXXX). Prioritaire sur le nom, résiste aux renommages"],
  ['guild name', 'guildName', 'Øgma Tuatha', 'Nom exact de la guilde sur Warcraft Logs'],
  ['realm', 'realm', 'Ysondre', 'Serveur de la guilde'],
  ['zone id', 'zoneId', '', 'Zone WCL du raid en cours (à changer à chaque saison)'],
  ['Partition', 'partition', '', 'Partition WCL (vide = toutes)'],
  ['Date de patch', 'seasonStart', '', 'Début de saison pour la présence (vide = détection auto)'],
  ['Jours de raid', 'raidDays', 'mercredi, jeudi, dimanche', 'Jours de raid (heure de Paris), séparés par des virgules'],
  ['Difficulté', 'difficulty', 'auto', 'auto, normal, heroique ou mythique (difficulté utilisée pour la perf WCL)'],
  ['Wipe cutoff', 'wipeCutoff', 3, 'Sur un wipe, les morts après la N-ième sont ignorées'],
  ['Poids présence', 'wPresence', 20, ''],
  ['Poids équipement', 'wStuff', 20, ''],
  ['Poids perf', 'wPerf', 30, ''],
  ['Poids survie', 'wSurvie', 30, ''],
  ['Présence min %', 'presMin', 75, '% de présence sous lequel la note vaut 0'],
  ['Perf min', 'perfMin', 45, 'Parse moyen sous lequel la note vaut 0'],
  ['Marge ilvl', 'stuffMargin', 14, "ilvl au-dessus du coffre de référence qui donne directement la note max"],
  ['Pulls min survie', 'survieMinPulls', 5, 'Pulls minimum dans la semaine pour noter la survie'],
  ['Plancher morts/pull', 'survieRateFloor', 0.05, "Morts/pull de référence minimum (évite qu'une seule mort coûte tout en farm)"],
];

const DAY_NUMBERS = { lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 7 };
const DIFFICULTIES = { normal: 3, heroique: 4, mythique: 5 };

/** À lancer une fois : ajoute à droite de Settings les colonnes qui manquent, avec leur valeur par défaut. */
function setupSettings() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEETS.settings) || ss.insertSheet(SHEETS.settings);
  const lastCol = sheet.getLastColumn();
  const headers = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(normalize_) : [];
  let col = lastCol;
  SETTINGS_COLUMNS.forEach(function (c) {
    if (headers.indexOf(normalize_(c[0])) !== -1) return;
    col++;
    sheet.getRange(1, col).setValue(c[0]).setFontWeight('bold');
    sheet.getRange(2, col).setValue(c[2]);
    if (c[3]) sheet.getRange(1, col).setNote(c[3]);
  });
}

function getConfig() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.settings);
  if (!sheet) throw new Error('Onglet Settings introuvable.');
  const lastCol = sheet.getLastColumn();
  const values = sheet.getRange(1, 1, 2, lastCol).getValues();
  const byHeader = {};
  values[0].forEach(function (h, i) { if (h !== '') byHeader[normalize_(h)] = values[1][i]; });

  const raw = {};
  SETTINGS_COLUMNS.forEach(function (c) {
    const v = byHeader[normalize_(c[0])];
    raw[c[1]] = v === undefined ? c[2] : v; // colonne absente -> valeur par défaut
  });
  const num = function (k) {
    const v = Number(raw[k]);
    if (raw[k] === '' || isNaN(v)) throw new Error('Settings : valeur numérique attendue pour ' + k);
    return v;
  };
  const raidDays = String(raw.raidDays || '').split(',')
    .map(function (d) { return DAY_NUMBERS[normalize_(d)]; })
    .filter(Boolean);
  if (!raidDays.length) throw new Error('Settings : "Jours de raid" ne contient aucun jour reconnu.');

  return {
    guildId: numOrNull_(raw.guildId),
    guildName: String(raw.guildName),
    guildServer: realmSlug_(raw.realm),
    region: 'eu',
    zoneId: numOrNull_(raw.zoneId),
    partition: numOrNull_(raw.partition),
    raidDays: raidDays,
    seasonStart: raw.seasonStart ? toDate_(raw.seasonStart) : null,
    difficulty: DIFFICULTIES[normalize_(raw.difficulty)] || null, // null = auto
    wipeCutoff: num('wipeCutoff'),
    weights: {
      presence: num('wPresence'),
      stuff: num('wStuff'),
      perf: num('wPerf'),
      survie: num('wSurvie'),
    },
    presMin: num('presMin'),
    perfMin: num('perfMin'),
    stuffMargin: num('stuffMargin'),
    survieMinPulls: num('survieMinPulls'),
    survieRateFloor: num('survieRateFloor'),
  };
}

function getSecret_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('Propriété de script manquante : ' + key);
  return v;
}

// ---------- utilitaires ----------

function normalize_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Clé unique d'un personnage : "nom-royaume" (royaume sans accents ni espaces). */
function charKey_(name, realm) {
  return String(name).toLowerCase() + '-' + normalize_(realm).replace(/[^a-z0-9]/g, '');
}

/** Slug de royaume façon Blizzard / WCL : "Confrérie du Thorium" -> "confrerie-du-thorium". */
function realmSlug_(realm) {
  return normalize_(realm).replace(/'/g, '').replace(/\s+/g, '-');
}

function toDate_(v) {
  if (v instanceof Date) return v;
  return new Date(String(v).trim() + 'T00:00:00');
}

function path_(obj, p) {
  return p.split('.').reduce(function (a, k) { return a == null ? undefined : a[k]; }, obj);
}

function numOrNull_(v) {
  return v == null || v === '' || isNaN(Number(v)) ? null : Number(v);
}

/** Index par "nom-royaume", avec repli sur le nom seul quand une source ne donne pas le royaume. */
function Index_() { this.full = {}; this.byName = {}; }
Index_.prototype.add = function (name, realm, val) {
  if (realm) this.full[charKey_(name, realm)] = val;
  this.byName[String(name).toLowerCase()] = val;
};
Index_.prototype.get = function (name, realm) {
  const k = charKey_(name, realm);
  if (Object.prototype.hasOwnProperty.call(this.full, k)) return this.full[k];
  return this.byName[String(name).toLowerCase()];
};
