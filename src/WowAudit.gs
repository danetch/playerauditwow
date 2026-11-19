/**
 * WowAudit.gs — roster, présence, coffre M+, ilvl.
 */

function waRequest_(path) {
  return request_(URLS.wowAudit + path, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + getSecret_('WA_SECRET') },
  });
}

function waGet_(path) {
  return fetchJson_(waRequest_(path));
}

function getWaCurrentPeriod_() {
  return Number(waGet_('v1/period').current_period);
}

/** [{ id, name, realm, class, role, ... }] */
function getWaRoster_() {
  return waGet_('v1/characters');
}

/** Index personnage -> % de présence depuis startDate. */
function getWaAttendance_(startDate) {
  const d = Utilities.formatDate(startDate, TZ, 'yyyy-MM-dd');
  const json = waGet_('v1/attendance?start_date=' + d);
  const idx = new Index_();
  (json.characters || []).forEach(function (c) {
    idx.add(c.name, c.realm, numOrNull_(c.attended_percentage));
  });
  return idx;
}

/** Index personnage -> { opt2, opt3 } : ilvl des emplacements 2 et 3 du coffre donjons de la période. */
function getWaVault_(period) {
  const json = waGet_('v1/historical_data?period=' + period);
  const idx = new Index_();
  (json.characters || []).forEach(function (c) {
    const d = path_(c, 'data.vault_options.dungeons');
    idx.add(c.name, c.realm, d ? { opt2: numOrNull_(d.option_2), opt3: numOrNull_(d.option_3) } : null);
  });
  return idx;
}

/** id WowAudit -> ilvl moyen du meilleur équipement (appels en parallèle). */
function getWaIlvls_(roster) {
  const res = fetchAllJson_(roster.map(function (c) { return waRequest_('v1/historical_data/' + c.id); }), 10);
  const out = {};
  roster.forEach(function (c, i) { out[c.id] = averageIlvl_(res[i].best_gear); });
  return out;
}

function averageIlvl_(gear) {
  if (!gear) return null;
  let sum = 0;
  let n = 0;
  Object.keys(gear).forEach(function (slot) {
    if (slot === 'off_hand') return;
    const v = gear[slot] && Number(gear[slot].ilvl);
    if (v) { sum += v; n++; }
  });
  return n ? sum / n : null;
}

/**
 * Repli si SEASON_START est vide : premier raid après la dernière pause de plus de 14 jours.
 * (Version corrigée de l'ancien getPatchStartDate.)
 */
function detectSeasonStart_() {
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty('seasonStartAuto');
  const now = Date.now();
  if (cached && now - Number(cached) < 140 * 24 * 3600 * 1000) return new Date(Number(cached));

  const dates = (waGet_('v1/raids?include_past=true').raids || [])
    .map(function (r) { return Date.parse(r.date); })
    .filter(function (t) { return !isNaN(t) && t <= now; })
    .sort(function (a, b) { return a - b; });
  if (!dates.length) throw new Error('Aucun raid WowAudit : renseigne "Date de patch" dans Settings.');

  let start = dates[0];
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] - dates[i - 1] > 14 * 24 * 3600 * 1000) start = dates[i];
  }
  props.setProperty('seasonStartAuto', String(start));
  return new Date(start);
}
