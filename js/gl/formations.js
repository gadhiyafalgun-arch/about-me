/* ═══════════════════════════════════════════════════════
   js/gl/formations.js — where the points arrange themselves for each section.

   Each generator fills a Float32Array of `count * 3` positions in world units. The field is sized
   for a camera at z ≈ 70 with a 35° fov, which frames roughly 70 × 44 units.

   These carry the meaning the per-section 2D canvases used to: the Quant formation really is a
   set of geometric-Brownian-motion paths, the ML formation really is the [3,5,5,4,2] network that
   used to be drawn in 2D. Same ideas, one system.
   ═══════════════════════════════════════════════════════ */

const SPAN_X = 40, SPAN_Y = 22, SPAN_Z = 24;

/* Deterministic RNG (mulberry32) so a formation looks identical on every visit and across
   tier changes. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Box-Muller — used by the formations that are genuinely statistical (GBM, orbitals). */
function gauss(r) {
  let u = 0, v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ── Hero: Fibonacci sphere shell with an inner haze ────────────────────────────────────────── */
function sphere(n, out) {
  const r = rng(1);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const shell = r() > 0.32;
    const t = i / n;
    const y = 1 - t * 2;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    // Shell points sit on the surface; the rest fill inward so the sphere has body.
    const k = shell ? 1 : Math.pow(r(), 0.45);
    const R = 20 * k + (shell ? gauss(r) * 0.5 : 0);
    out[i * 3]     = Math.cos(th) * rad * R * 1.35;
    out[i * 3 + 1] = y * R * 0.78;
    out[i * 3 + 2] = Math.sin(th) * rad * R;
  }
}

/* ── Quant: geometric Brownian motion paths ─────────────────────────────────────────────────
   Same process the old 2D canvas drew — drift + volatility on a log scale — but the paths now
   fan through depth and the points are the sample steps. */
function gbm(n, out) {
  const r = rng(2);
  const PATHS = 190;
  const per = Math.ceil(n / PATHS);
  const mu = 0.06 / 252, sigma = 0.21 / Math.sqrt(252);
  let i = 0;
  for (let p = 0; p < PATHS && i < n; p++) {
    let logPrice = 0;
    const z = (r() - 0.5) * 2 * SPAN_Z;
    const yBias = gauss(r) * 1.5;
    const vol = 0.6 + r() * 1.1;                       // per-path volatility spread
    for (let s = 0; s < per && i < n; s++, i++) {
      const frac = s / per;
      logPrice += mu + sigma * gauss(r) * vol;
      out[i * 3]     = -SPAN_X + frac * SPAN_X * 2;
      out[i * 3 + 1] = logPrice * 165 + yBias;          // log-return → world units
      out[i * 3 + 2] = z * (0.35 + frac * 0.65);        // paths fan outward in depth over time
    }
  }
}

/* ── Physics: hydrogen-like orbital lobes ───────────────────────────────────────────────────
   Rejection-sampled |Y|² for a p_z and a d_z² lobe, over three shells. Reads as electron
   probability density rather than as the "planet orbits" cliché. */
function orbital(n, out) {
  const r = rng(3);
  const shells = [12, 24];
  for (let i = 0; i < n; i++) {
    const s = shells[i % 2];
    let ct, w, tries = 0;
    do {
      ct = r() * 2 - 1;                                 // cos(theta)
      // Alternate between a p-type and a d-type angular distribution. Raised to a power to
      // sharpen the lobes — the textbook |Y|² is too soft to read once it is projected to 2D.
      w = (i % 2 === 0) ? Math.pow(ct * ct, 2.2)
                        : Math.pow(Math.pow(3 * ct * ct - 1, 2) / 4, 1.8);
      tries++;
    } while (r() > w && tries < 12);

    const st  = Math.sqrt(Math.max(0, 1 - ct * ct));
    const phi = r() * Math.PI * 2;
    const R   = s + gauss(r) * 1.5;                     // radial thickness of the shell
    // Squashed in z so the lobes present a face to the camera instead of averaging into a
    // spherical haze when projected.
    out[i * 3]     = R * st * Math.cos(phi) * 1.5;
    out[i * 3 + 1] = R * ct * 1.15;
    out[i * 3 + 2] = R * st * Math.sin(phi) * 0.40;
  }
}

/* ── ML / AI: the [3,5,5,4,2] layered network ───────────────────────────────────────────────
   Points either cluster at a node or ride an edge between consecutive layers. */
function network(n, out) {
  const r = rng(4);
  const LAYERS = [3, 5, 5, 4, 2];
  const nodes = [];
  LAYERS.forEach((cnt, li) => {
    for (let k = 0; k < cnt; k++) {
      nodes.push({
        layer: li,
        x: -SPAN_X * 0.85 + (li / (LAYERS.length - 1)) * SPAN_X * 1.7,
        y: ((k + 0.5) / cnt - 0.5) * SPAN_Y * 1.7,
        z: (r() - 0.5) * 10,
      });
    }
  });
  const byLayer = LAYERS.map((_, li) => nodes.filter(nd => nd.layer === li));

  for (let i = 0; i < n; i++) {
    if (r() < 0.30) {                                    // node cloud
      const nd = nodes[(r() * nodes.length) | 0];
      out[i * 3]     = nd.x + gauss(r) * 1.5;
      out[i * 3 + 1] = nd.y + gauss(r) * 1.5;
      out[i * 3 + 2] = nd.z + gauss(r) * 1.5;
    } else {                                             // edge
      const li = (r() * (LAYERS.length - 1)) | 0;
      const a  = byLayer[li][(r() * byLayer[li].length) | 0];
      const b  = byLayer[li + 1][(r() * byLayer[li + 1].length) | 0];
      const t  = r();
      out[i * 3]     = a.x + (b.x - a.x) * t;
      out[i * 3 + 1] = a.y + (b.y - a.y) * t + gauss(r) * 0.35;
      out[i * 3 + 2] = a.z + (b.z - a.z) * t + gauss(r) * 0.35;
    }
  }
}

/* ── Data Engineering: laminar flow through a waist ─────────────────────────────────────────
   Wide at the source, pinched at the transform stage, wide again at the sink. */
function stream(n, out) {
  const r = rng(5);
  for (let i = 0; i < n; i++) {
    const t = r();
    const x = -SPAN_X + t * SPAN_X * 2;
    // Waist at the midpoint: radius collapses to ~15% and opens back up.
    const waist = 0.15 + 0.85 * Math.pow(Math.abs(t - 0.5) * 2, 1.6);
    const ang = r() * Math.PI * 2;
    const rad = Math.pow(r(), 0.6) * SPAN_Y * waist;
    // Slight helical twist through the pinch so the flow reads as directional.
    const twist = (t - 0.5) * 2.2;
    out[i * 3]     = x;
    out[i * 3 + 1] = Math.cos(ang + twist) * rad;
    out[i * 3 + 2] = Math.sin(ang + twist) * rad * 1.1;
  }
}

/* ── Automation: orthogonal lattice with junctions ──────────────────────────────────────────
   Points ride the edges of a 3D grid, with denser clusters where traces meet. */
function lattice(n, out) {
  const r = rng(6);
  const STEP = 10;
  // Only three planes deep. A grid spread through the full depth span projects into an even
  // speckle — the orthogonal structure only survives if the layers do not stack up.
  const DEPTH = STEP;
  for (let i = 0; i < n; i++) {
    const gx = (Math.round((r() * 2 - 1) * SPAN_X / STEP)) * STEP;
    const gy = (Math.round((r() * 2 - 1) * SPAN_Y / STEP)) * STEP;
    const gz = (Math.round((r() * 2 - 1) * DEPTH / STEP)) * STEP;
    if (r() < 0.22) {                                    // junction node
      out[i * 3]     = gx + gauss(r) * 0.8;
      out[i * 3 + 1] = gy + gauss(r) * 0.8;
      out[i * 3 + 2] = gz + gauss(r) * 0.8;
    } else {                                             // run along one axis
      const axis = (r() * 3) | 0;
      const run  = (r() - 0.5) * STEP;
      out[i * 3]     = gx + (axis === 0 ? run : 0) + gauss(r) * 0.22;
      out[i * 3 + 1] = gy + (axis === 1 ? run : 0) + gauss(r) * 0.22;
      out[i * 3 + 2] = gz + (axis === 2 ? run : 0) + gauss(r) * 0.22;
    }
  }
}

/* ── Skills: equalizer bands ────────────────────────────────────────────────────────────────
   Bar lengths are the actual skill percentages from the markup, so the background is a
   restatement of the progress bars rather than decoration. */
function bands(n, out) {
  const r = rng(7);
  const PCT = [95, 80, 72, 88, 85];
  for (let i = 0; i < n; i++) {
    const b = i % PCT.length;
    const len = (PCT[b] / 100) * SPAN_X * 1.7;
    const y = ((b + 0.5) / PCT.length - 0.5) * SPAN_Y * 1.6;
    const t = Math.pow(r(), 0.85);                       // denser toward the origin
    out[i * 3]     = -SPAN_X * 0.85 + t * len;
    out[i * 3 + 1] = y + gauss(r) * 1.05;
    out[i * 3 + 2] = (r() - 0.5) * 14;
  }
}

/* ── Experience: a vertical helix spine ─────────────────────────────────────────────────────── */
function helix(n, out) {
  const r = rng(8);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const strand = i % 2 === 0 ? 0 : Math.PI;            // double helix
    const ang = t * Math.PI * 7 + strand;
    const R = 13 + gauss(r) * 1.1;
    const off = r() < 0.18 ? (r() - 0.5) * 22 : 0;       // occasional cross-links
    out[i * 3]     = Math.cos(ang) * R + off;
    out[i * 3 + 1] = (t - 0.5) * SPAN_Y * 2.1;
    out[i * 3 + 2] = Math.sin(ang) * R;
  }
}

/* ── Contact: converge to a plane, then drift outward ───────────────────────────────────────── */
function dissolve(n, out) {
  const r = rng(9);
  for (let i = 0; i < n; i++) {
    const ang = r() * Math.PI * 2;
    const rad = Math.pow(r(), 0.35) * SPAN_X * 1.05;
    out[i * 3]     = Math.cos(ang) * rad;
    out[i * 3 + 1] = Math.sin(ang) * rad * 0.55;
    out[i * 3 + 2] = gauss(r) * 2.2;                     // nearly flat
  }
}

const GENERATORS = { sphere, gbm, orbital, network, stream, lattice, bands, helix, dissolve };

/* Scene id → formation. s9 (About) returns to the hero sphere, closing the loop. */
export const SCENE_FORMATION = {
  s0: 'sphere', s2: 'gbm',    s3: 'orbital', s4: 'network', s5: 'stream',
  s6: 'lattice', s7: 'bands', s8: 'helix',   s9: 'sphere',  s10: 'dissolve',
};

const cache = new Map();

/* Generated on first use and cached — scrubbing back and forth must not re-run a generator. */
export function getFormation(name, count) {
  const key = `${name}:${count}`;
  let arr = cache.get(key);
  if (arr) return arr;
  const gen = GENERATORS[name] || GENERATORS.sphere;
  arr = new Float32Array(count * 3);
  gen(count, arr);
  cache.set(key, arr);
  return arr;
}

export function clearFormationCache() { cache.clear(); }
