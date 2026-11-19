/**
 * Scoring.gs — transforme les données brutes en points.
 * Chaque note vaut null quand la donnée manque (au lieu de 0 ou NaN).
 */

function scorePresence_(pct, cfg) {
  if (pct == null) return null;
  if (pct < cfg.presMin) return 0;
  return Math.round(cfg.weights.presence * (pct - cfg.presMin) / (100 - cfg.presMin));
}

/** Même courbe que l'ancien perfPoints (montée cubique sur 5 points, puis linéaire), ramenée au poids configuré. */
function scorePerf_(perf, cfg) {
  if (perf == null) return null;
  const p0 = cfg.perfMin;
  let y; // sur 30
  if (perf < p0) y = 0;
  else if (perf < p0 + 5) y = Math.pow(perf - p0, 3) / 12.5;
  else y = 10 + (perf - (p0 + 5)) * 20 / (100 - (p0 + 5));
  return Math.round(Math.min(y, 30) * cfg.weights.perf / 30);
}

/** ref = { slot2, slot3 } : ilvl de coffre le plus fréquent dans le roster. */
function scoreStuff_(ilvl, vault, ref, cfg) {
  const w = cfg.weights.stuff;
  if (ilvl == null && !vault) return null;
  if (ilvl != null && ref.slot2 != null && ilvl >= ref.slot2 + cfg.stuffMargin) return w;
  let s = 0;
  if (vault && vault.opt2 != null && ref.slot2 != null && vault.opt2 >= ref.slot2) s += w / 2;
  if (vault && vault.opt3 != null && ref.slot3 != null && vault.opt3 >= ref.slot3) s += w / 2;
  return Math.round(s);
}

/**
 * Survie : morts par pull comparées à la moyenne du raid.
 * 0 mort = note max, moyenne du raid = moitié, deux fois la moyenne ou plus = 0.
 */
function scoreSurvie_(stat, refRate, cfg) {
  if (!stat || stat.pulls < cfg.survieMinPulls) return null;
  const ref = Math.max(refRate, cfg.survieRateFloor);
  const rate = stat.deaths / stat.pulls;
  return Math.round(cfg.weights.survie * Math.max(0, Math.min(1, 1 - rate / (2 * ref))));
}

function mode_(values) {
  const counts = {};
  let best = null;
  let bestCount = 0;
  values.forEach(function (v) {
    if (v == null) return;
    counts[v] = (counts[v] || 0) + 1;
    if (counts[v] > bestCount) { bestCount = counts[v]; best = v; }
  });
  return best;
}

/** Calcule une ligne par joueur du roster pour la semaine. */
function computeWeek_(cfg, d) {
  const roster = d.roster;
  const vaults = roster.map(function (c) { return d.vault.get(c.name, c.realm) || null; });
  const ref = {
    slot2: mode_(vaults.map(function (v) { return v && v.opt2; })),
    slot3: mode_(vaults.map(function (v) { return v && v.opt3; })),
  };

  // Moyenne de morts par pull du raid (joueurs avec assez de pulls).
  let deaths = 0;
  let pulls = 0;
  roster.forEach(function (c) {
    const s = d.raids.stats.get(c.name, c.realm);
    if (s && s.pulls >= cfg.survieMinPulls) { deaths += s.deaths; pulls += s.pulls; }
  });
  const refRate = pulls ? deaths / pulls : 0;

  const now = new Date();
  return roster.map(function (c, i) {
    const pres = d.attendance.get(c.name, c.realm);
    const stat = d.raids.stats.get(c.name, c.realm) || null;
    const ilvl = d.ilvls[c.id];
    const vault = vaults[i];
    const perf = d.perf[c.id];

    const parts = {
      presence: scorePresence_(pres == null ? null : pres, cfg),
      stuff: scoreStuff_(ilvl, vault, ref, cfg),
      perf: scorePerf_(perf, cfg),
      survie: scoreSurvie_(stat, refRate, cfg),
    };
    const labels = { presence: 'présence', stuff: 'équipement', perf: 'perf', survie: 'survie' };
    let got = 0;
    let max = 0;
    const missing = [];
    Object.keys(parts).forEach(function (k) {
      if (parts[k] == null) missing.push(labels[k]);
      else { got += parts[k]; max += cfg.weights[k]; }
    });
    const raided = !!(stat && stat.pulls > 0);
    const total = raided && max ? Math.round(100 * got / max) : null;

    return [
      d.period,
      d.bounds.start,
      c.name,
      c.realm,
      c.class || '',
      c.role || '',
      pres == null ? '' : pres,
      blank_(parts.presence),
      ilvl == null ? '' : Math.round(ilvl * 10) / 10,
      vault && vault.opt2 != null ? vault.opt2 : '',
      vault && vault.opt3 != null ? vault.opt3 : '',
      blank_(parts.stuff),
      perf == null ? '' : Math.round(perf * 10) / 10,
      blank_(parts.perf),
      stat ? stat.pulls : 0,
      stat ? stat.deaths : 0,
      stat && stat.pulls ? Math.round(100 * stat.deaths / stat.pulls) / 100 : '',
      blank_(parts.survie),
      blank_(total),
      raided ? missing.join(', ') : "n'a pas raidé cette semaine",
      now,
    ];
  });
}

function blank_(v) { return v == null ? '' : v; }
