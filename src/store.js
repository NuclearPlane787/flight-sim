// localStorage under the game's prefix. Every access is wrapped: storage can be missing
// or blocked (private windows, previews), and the game must run without it.

const PREFIX = 'gamedump:flight-sim:';

export function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// The logbook keeps the newest 200 flights.
export function addLogEntry(entry) {
  const log = load('logbook', []);
  log.push(entry);
  while (log.length > 200) log.shift();
  save('logbook', log);
  return log;
}
