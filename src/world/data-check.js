// v0.8.0: since v0.8.0 the baked world (data/) is a repository of its own, cloned into the game's folder
// (README.md, "Getting the data"). Without it every loader finds nothing and the game used to fail with
// no word of why: main.js asks checkData() first and, when the region's manifest isn't there, puts this
// one line on the loading screen instead. It reads only the game's own folder (the region's data URL).

export const DATA_REPO = 'https://github.com/NuclearPlane787/flight-sim-data.git';
export const DATA_CLONE = `git clone ${DATA_REPO} data`;
export const DATA_MISSING_LINE = `The game's data isn't here: in games/flight-sim, run  ${DATA_CLONE}`;

// Pure: is the data missing, from the first fetch's outcome? `res` is the Response (or null when the
// fetch itself threw), `json` what its body parsed to (undefined when it didn't parse). A manifest is a
// JSON object; a 404 page, an HTML index or a parse failure counts as missing.
export function dataMissing(res, json) {
  if (!res || !res.ok) return true;
  return !(json && typeof json === 'object' && !Array.isArray(json));
}

// The loading screen's line when the region's data folder has no manifest.json, else null.
// base: the region's data URL (regions.js's dataUrl()), ending in '/'.
export async function checkData(base, fetchFn = (u) => fetch(u)) {
  let res = null, json;
  try {
    res = await fetchFn(new URL('manifest.json', base).href);
    if (res && res.ok) json = await res.json();
  } catch (e) { /* no answer, or not JSON: missing */ }
  return dataMissing(res, json) ? DATA_MISSING_LINE : null;
}
