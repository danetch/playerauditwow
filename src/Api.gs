/**
 * Api.gs — appels HTTP, tokens mis en cache, requêtes parallèles.
 */

function request_(url, opts) {
  return Object.assign({ url: url, muteHttpExceptions: true }, opts || {});
}

function parse_(res, url) {
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code >= 300) throw new Error('HTTP ' + code + ' sur ' + url + ' : ' + text.slice(0, 300));
  return JSON.parse(text);
}

function fetchJson_(req) {
  return parse_(UrlFetchApp.fetch(req.url, req), req.url);
}

/** Lance les requêtes en parallèle, par paquets, pour ménager les limites des API. */
function fetchAllJson_(reqs, chunkSize) {
  const size = chunkSize || 10;
  let out = [];
  for (let i = 0; i < reqs.length; i += size) {
    const chunk = reqs.slice(i, i + size);
    const res = UrlFetchApp.fetchAll(chunk);
    out = out.concat(res.map(function (r, j) { return parse_(r, chunk[j].url); }));
  }
  return out;
}

function cachedToken_(cacheKey, fetcher) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const token = fetcher();
  cache.put(cacheKey, token, 6 * 3600); // 6 h = durée max du cache
  return token;
}

// ---------- Warcraft Logs ----------

function getWclToken_() {
  return cachedToken_('wclToken', function () {
    const auth = Utilities.base64Encode(getSecret_('WCL_ID') + ':' + getSecret_('WCL_SECRET'));
    return fetchJson_(request_(URLS.wclAuth, {
      method: 'post',
      headers: { Authorization: 'Basic ' + auth },
      payload: { grant_type: 'client_credentials' },
    })).access_token;
  });
}

function wclRequest_(query, variables) {
  return request_(URLS.wcl, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + getWclToken_() },
    payload: JSON.stringify({ query: query, variables: variables || {} }),
  });
}

/** strict = true : toute erreur GraphQL fait échouer le run. */
function wclData_(json, strict) {
  if (json.errors) {
    const msg = 'WCL : ' + JSON.stringify(json.errors).slice(0, 500);
    if (strict || !json.data) throw new Error(msg);
    Logger.log(msg);
  }
  return json.data;
}

function wclQuery_(query, variables) {
  return wclData_(fetchJson_(wclRequest_(query, variables)), true);
}

// ---------- Battle.net ----------

function getBnetToken_() {
  return cachedToken_('bnetToken', function () {
    const auth = Utilities.base64Encode(getSecret_('BNET_ID') + ':' + getSecret_('BNET_SECRET'));
    return fetchJson_(request_(URLS.bnetAuth, {
      method: 'post',
      headers: { Authorization: 'Basic ' + auth },
      payload: { grant_type: 'client_credentials' },
    })).access_token;
  });
}

/** Début / fin d'une semaine WoW (reset à reset). */
function getPeriodBounds_(period) {
  const json = fetchJson_(request_(URLS.bnet + 'data/wow/mythic-keystone/period/' + period, {
    headers: { Authorization: 'Bearer ' + getBnetToken_(), 'Battlenet-Namespace': 'dynamic-eu' },
  }));
  return { start: new Date(json.start_timestamp), end: new Date(json.end_timestamp) };
}
