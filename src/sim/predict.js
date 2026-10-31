// The main-thread side of the path prediction:
//   const p = createPredictor(); p.onresult = ({ samples, reason }) => …; p.request(sim.snapshot());
// One module worker, created on the first request. A new request cancels the one running.
// A jump is sim.restore(sample.snap).
// The worker flies the path over the real terrain once it has loaded the heights (it starts
// on the first request; until then the ground is flat sea level, and `terrain` is false).
// The same request may then get a second result, over the terrain. reason 'terrain': the
// path flies into the ground; its last sample has terrain: true and impact { t, x, y, z }.

export function createPredictor() {
  let worker = null;
  let id = 0;
  const pred = {
    onresult: null,
    onerror: null,
    busy: false,
    request(snap, opts = {}) {
      if (!worker) {
        worker = new Worker(new URL('./predict-worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = (ev) => {
          const m = ev.data;
          if (m.id !== id) return; // stale
          pred.busy = false;
          if (m.type === 'result' && pred.onresult) pred.onresult({ samples: m.samples, reason: m.reason, cpuMs: m.cpuMs, terrain: m.terrain });
          if (m.type === 'error' && pred.onerror) pred.onerror(m.message);
        };
        worker.onerror = (e) => { pred.busy = false; if (pred.onerror) pred.onerror(e.message || 'worker error'); };
      }
      id++;
      pred.busy = true;
      worker.postMessage({ type: 'request', id, snap, opts });
      return id;
    },
    cancel() {
      if (!worker) return;
      id++;
      pred.busy = false;
      worker.postMessage({ type: 'cancel', id });
    },
    // Stops the worker for good (e.g. when the game is torn down).
    dispose() { if (worker) worker.terminate(); worker = null; pred.busy = false; },
  };
  return pred;
}
