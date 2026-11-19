/**
 * Wcl.gs — rapports de la semaine, pulls / morts par joueur, perf.
 */

/**
 * Tous les rapports de la guilde entre deux dates, restreints aux jours de raid configurés.
 * Renvoie { reports, stats (Index_ -> {pulls, deaths}), difficulty, signature, lastReportTime }.
 */
function getWeekRaids_(cfg, bounds) {
  // GraphQL refuse les variables déclarées mais inutilisées : on ne déclare que celles du mode choisi.
  const byId = !!cfg.guildId;
  const varDefs = byId
    ? '$guildId:Int,$start:Float,$end:Float'
    : '$guild:String,$server:String,$region:String,$start:Float,$end:Float';
  const guildArgs = byId
    ? 'guildID:$guildId'
    : 'guildName:$guild,guildServerSlug:$server,guildServerRegion:$region';
  const listQuery = 'query(' + varDefs + '){' +
    ' reportData{ reports(' + guildArgs + ',' +
    ' startTime:$start,endTime:$end,limit:25){ data{ code startTime endTime' +
    ' fights(killType:Encounters){ id encounterID difficulty kill friendlyPlayers }' +
    ' masterData{ actors(type:"Player"){ id name server } } } } } }';

  const variables = { start: bounds.start.getTime(), end: bounds.end.getTime() };
  if (byId) {
    variables.guildId = cfg.guildId;
  } else {
    variables.guild = cfg.guildName;
    variables.server = cfg.guildServer;
    variables.region = cfg.region;
  }
  const data = wclQuery_(listQuery, variables);

  const reports = (path_(data, 'reportData.reports.data') || [])
    .filter(function (r) { return cfg.raidDays.indexOf(dayOfWeek_(r.startTime)) !== -1; })
    .map(function (r) {
      r.fights = (r.fights || []).filter(function (f) {
        return f.encounterID && f.difficulty >= 3; // Normal, Héroïque, Mythique
      });
      return r;
    })
    .filter(function (r) { return r.fights.length; })
    .sort(function (a, b) { return a.startTime - b.startTime; });

  const result = {
    reports: reports,
    stats: new Index_(),
    difficulty: null,
    signature: reports.map(function (r) { return r.code + ':' + r.endTime + ':' + r.fights.length; }).join('|'),
    lastReportTime: reports.length ? new Date(reports[reports.length - 1].startTime) : null,
  };
  if (!reports.length) return result;

  // Difficulté principale = celle où le raid a fait le plus de pulls (sauf si forcée dans Settings).
  const pullsByDifficulty = {};
  reports.forEach(function (r) {
    r.fights.forEach(function (f) { pullsByDifficulty[f.difficulty] = (pullsByDifficulty[f.difficulty] || 0) + 1; });
  });
  result.difficulty = cfg.difficulty || Number(Object.keys(pullsByDifficulty).sort(function (a, b) {
    return pullsByDifficulty[b] - pullsByDifficulty[a];
  })[0]);

  // Morts + parses des kills de tous les rapports, en une seule requête (alias r0, r1, ...).
  const detailQuery = 'query{ reportData{ ' + reports.map(function (r, i) {
    const ids = r.fights.map(function (f) { return f.id; }).join(',');
    return 'r' + i + ': report(code:"' + r.code + '"){' +
      ' table(dataType:Deaths, fightIDs:[' + ids + '], wipeCutoff:' + cfg.wipeCutoff + ')' +
      ' rankings(fightIDs:[' + ids + '], difficulty:' + result.difficulty + ') }';
  }).join(' ') + ' } }';
  const detail = wclQuery_(detailQuery, {}).reportData;

  const byKey = {};
  const statFor = function (name, server) {
    const k = charKey_(name, server || '');
    if (!byKey[k]) {
      byKey[k] = { name: name, server: server, pulls: 0, deaths: 0, parses: [], bracketParses: [] };
      result.stats.add(name, server, byKey[k]);
    }
    return byKey[k];
  };

  reports.forEach(function (r, i) {
    const actors = {};
    (path_(r, 'masterData.actors') || []).forEach(function (a) { actors[a.id] = a; });

    r.fights.forEach(function (f) {
      (f.friendlyPlayers || []).forEach(function (id) {
        const a = actors[id];
        if (a) statFor(a.name, a.server).pulls++;
      });
    });

    (path_(detail, 'r' + i + '.table.data.entries') || []).forEach(function (e) {
      const a = actors[e.id] || { name: e.name, server: '' };
      statFor(a.name, a.server).deaths++;
    });

    // Un parse par joueur et par kill classé.
    (path_(detail, 'r' + i + '.rankings.data') || []).forEach(function (fight) {
      ['tanks', 'healers', 'dps'].forEach(function (role) {
        (path_(fight, 'roles.' + role + '.characters') || []).forEach(function (c) {
          const s = statFor(c.name, path_(c, 'server.name') || '');
          if (c.rankPercent != null) s.parses.push(Number(c.rankPercent));
          if (c.bracketPercent != null) s.bracketParses.push(Number(c.bracketPercent));
        });
      });
    });
  });

  // Perf de la semaine : meilleure moyenne entre parses généraux et parses par tranche d'ilvl.
  Object.keys(byKey).forEach(function (k) {
    const s = byKey[k];
    const avg = function (a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; };
    const values = [avg(s.parses), avg(s.bracketParses)].filter(function (v) { return v != null; });
    s.weekPerf = values.length ? Math.max.apply(null, values) : null;
    s.rankedKills = Math.max(s.parses.length, s.bracketParses.length);
  });
  return result;
}

/**
 * Perf de SAISON (pour information) de chaque joueur du roster : meilleure valeur entre le classement
 * par tranche d'ilvl et le classement général. null si aucun log classé.
 */
function getWclPerf_(cfg, roster, difficulty) {
  const rankArgs = (cfg.zoneId ? 'zoneID:' + cfg.zoneId + ',' : '') +
    (difficulty ? 'difficulty:' + difficulty + ',' : '') +
    'partition:' + (cfg.partition != null ? cfg.partition : -1) + ',';
  const chunks = [];
  for (let i = 0; i < roster.length; i += 8) chunks.push(roster.slice(i, i + 8));

  const reqs = chunks.map(function (chunk) {
    const body = chunk.map(function (c, j) {
      const args = 'name:' + JSON.stringify(c.name) +
        ',serverSlug:' + JSON.stringify(realmSlug_(c.realm)) +
        ',serverRegion:' + JSON.stringify(cfg.region);
      return 'b' + j + ': character(' + args + '){ zoneRankings(' + rankArgs + 'byBracket:true) } ' +
        'o' + j + ': character(' + args + '){ zoneRankings(' + rankArgs + 'byBracket:false) }';
    }).join(' ');
    return wclRequest_('query{ characterData{ ' + body + ' } }', {});
  });

  const out = {};
  fetchAllJson_(reqs, 5).forEach(function (json, ci) {
    const data = wclData_(json, false) || {};
    chunks[ci].forEach(function (c, j) {
      const values = ['b', 'o']
        .map(function (p) { return numOrNull_(path_(data, 'characterData.' + p + j + '.zoneRankings.bestPerformanceAverage')); })
        .filter(function (v) { return v != null; });
      out[c.id] = values.length ? Math.max.apply(null, values) : null;
    });
  });
  return out;
}

/** 1 = lundi ... 7 = dimanche, heure de Paris. */
function dayOfWeek_(ms) {
  return Number(Utilities.formatDate(new Date(ms), TZ, 'u'));
}
