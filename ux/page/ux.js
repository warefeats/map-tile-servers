// The in-page half of the UX harness: one MapLibre map pointed at one tile server. The map starts
// as soon as the page loads, the way a site's map would; the runner drives the camera through
// window.ux and reads the marks. Times are performance.now() milliseconds; the runner adds
// performance.timeOrigin to line them up with network events and screen frames.
(() => {
  const raw = new URLSearchParams(location.search).get("cfg");
  const cfg = JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/")));
  const now = () => performance.now();
  const marks = {};
  const errors = [];
  const tiles = [];
  const ux = { cfg, marks, errors, tiles, map: null };
  window.ux = ux;

  const view = cfg.view;
  const map = new maplibregl.Map({
    container: "map",
    style: cfg.style,
    center: [view.lon, view.lat],
    zoom: view.zoom,
    bearing: view.bearing || 0,
    pitch: view.pitch || 0,
    attributionControl: false,
  });
  ux.map = map;
  marks.create = now();

  map.on("error", (e) => {
    const err = e && e.error;
    errors.push({ t: now(), message: String((err && (err.message || err.status)) || err || "error"), url: (err && err.url) || null });
  });
  map.once("styledata", () => {
    marks.style = now();
  });
  map.on("sourcedata", (e) => {
    if (!e.tile || tiles.length >= 20000) return;
    const c = e.tile.tileID.canonical;
    tiles.push([now(), e.sourceId, c.z, c.x, c.y]);
    if (marks.firstTile === undefined) marks.firstTile = now();
  });
  map.once("load", () => {
    marks.load = now();
  });
  map.once("idle", () => {
    marks.idle = now();
  });

  function cameraOf(step) {
    const camera = { center: [step.lon, step.lat], zoom: step.zoom };
    if (step.bearing !== undefined) camera.bearing = step.bearing;
    if (step.pitch !== undefined) camera.pitch = step.pitch;
    return camera;
  }

  function move(step) {
    const camera = cameraOf(step);
    if (step.kind === "jump") map.jumpTo(camera);
    else if (step.kind === "fly") map.flyTo({ ...camera, duration: step.durationMs, essential: true });
    else map.easeTo({ ...camera, duration: step.durationMs, essential: true });
  }

  // One user action: a camera move (or several moves `gapMs` apart, as a quick scroll would make),
  // then the wait for the map to settle. Resolves with when it started, when the camera stopped,
  // and when the map went idle with every tile in view loaded.
  ux.act = (action) =>
    new Promise((resolve, reject) => {
      const moves = action.moves;
      const start = now();
      let moveEnd = null;
      const timer = setTimeout(() => {
        map.off("idle", onIdle);
        reject(new Error(`no idle within ${action.timeoutMs} ms of ${action.name}`));
      }, action.timeoutMs);
      function onIdle() {
        if (moveEnd === null) return;
        map.off("idle", onIdle);
        clearTimeout(timer);
        resolve({ start, moveEnd, idle: now() });
      }
      map.on("idle", onIdle);
      let i = 0;
      const next = () => {
        const last = i === moves.length - 1;
        move(moves[i]);
        i++;
        if (!last) {
          setTimeout(next, action.gapMs || 0);
        } else if (!map.isMoving()) {
          moveEnd = now();
        } else {
          // Listen only after the last move starts: interrupting an earlier move ends that one first.
          map.once("moveend", () => {
            moveEnd = now();
          });
        }
      };
      next();
    });
})();
