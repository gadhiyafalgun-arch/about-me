/* ═══════════════════════════════════════════════════════
   js/gl/scroll-link.js — ties the point field to scroll position.

   Three things are driven from scroll:

     morph       which formation the points are arranged into
     camera      one continuous journey through the field, not a cut per section
     dispersion  scroll velocity throws the field apart, then it settles

   The morph is shaped so each formation *holds* for the first part of its section and then
   transitions over the last part. A linear mapping would mean the field is never settled, which
   reads as noise; holding and then moving is what makes the change feel deliberate.
   ═══════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { getFormation, SCENE_FORMATION } from './formations.js';

const SCENES = ['s0', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10'];

/* Section palette. Mirrors the --c-* tokens in style.css so the field always agrees with the
   accent colour the rest of the page is using. */
const PALETTE = {
  s0:  ['#00ffe0', '#0077ff'],
  s2:  ['#00ffe0', '#0aa5ff'],   // quant
  s3:  ['#a78bfa', '#5b21b6'],   // physics
  s4:  ['#f472b6', '#7c3aed'],   // ml / ai
  s5:  ['#34d399', '#0e7490'],   // data
  s6:  ['#fb923c', '#b45309'],   // automation
  s7:  ['#00ffe0', '#0077ff'],   // skills
  s8:  ['#00ffe0', '#a78bfa'],   // experience
  s9:  ['#29fbff', '#0077ff'],   // about
  s10: ['#fb923c', '#f472b6'],   // contact
};

/* Fraction of a section spent holding the formation before the transition begins. */
const HOLD = 0.55;

export function linkScroll(field) {
  if (!field || typeof ScrollTrigger === 'undefined') return;

  const { geom, uniforms, camera } = field;
  const count = field.count;

  const attrA = geom.getAttribute('aPosA');
  const attrB = geom.getAttribute('aPosB');

  /* Which pair of formations is currently loaded into the buffers. -1 forces the first load. */
  let loadedPair = -1;

  function loadPair(idx) {
    if (idx === loadedPair) return;
    loadedPair = idx;
    const from = SCENE_FORMATION[SCENES[idx]];
    const to   = SCENE_FORMATION[SCENES[Math.min(idx + 1, SCENES.length - 1)]];
    attrA.array.set(getFormation(from, count));
    attrB.array.set(getFormation(to, count));
    attrA.needsUpdate = true;
    attrB.needsUpdate = true;
  }
  loadPair(0);

  /* ── Colour targets, lerped in the render loop rather than snapped ── */
  const colA = new THREE.Color(PALETTE.s0[0]);
  const colB = new THREE.Color(PALETTE.s0[1]);
  const tgtA = new THREE.Color(PALETTE.s0[0]);
  const tgtB = new THREE.Color(PALETTE.s0[1]);

  /* ── Per-section triggers ──
     Scene ranges are contiguous and non-overlapping, so exactly one is active at a time and
     onUpdate gives an unambiguous position within it. Driving morph from progress (rather than
     from enter/leave callbacks) means scrubbing backwards is correct for free. */
  SCENES.forEach((id, idx) => {
    const el = document.getElementById(id);
    if (!el) return;

    ScrollTrigger.create({
      trigger: el,
      start: 'top top',
      end: () => `+=${el.offsetHeight}`,
      invalidateOnRefresh: true,
      onUpdate: self => {
        loadPair(idx);
        // Hold, then transition over the remainder of the section.
        const p = self.progress;
        uniforms.uMorph.value = p <= HOLD ? 0 : (p - HOLD) / (1 - HOLD);

        const pal = PALETTE[id] || PALETTE.s0;
        tgtA.set(pal[0]);
        tgtB.set(pal[1]);
      },
    });
  });

  /* ── Camera journey ──
     One long path through the field across the whole document — dolly in and back out, with a
     slow lateral arc. Targets are set here and eased toward in the render loop so the camera
     never snaps, even when the user jumps via a nav link. */
  const camTarget = new THREE.Vector3(0, 0, 95);
  let dispRaw = 0;

  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: self => {
      const g = self.progress;
      camTarget.set(
        Math.sin(g * Math.PI * 2.0) * 13,
        Math.cos(g * Math.PI * 1.5) * 7,
        95 - Math.sin(g * Math.PI) * 26,          // closest around the middle of the page
      );
      // Scroll velocity → dispersion. Divisor chosen so an ordinary wheel flick reads ~0.3 and
      // a hard fling saturates.
      dispRaw = Math.min(Math.abs(self.getVelocity()) / 4200, 1);
    },
  });

  /* ── Per-frame easing ──
     Runs after scene.js's own render callback on the same ticker, so this still costs no extra
     rAF loop. Every value here is eased rather than assigned, which is what keeps fast scrolling
     from looking like a jump-cut.

     Smoothing is time-based, not per-frame. A plain `x += (target - x) * 0.1` settles at whatever
     speed the display happens to run at — twice as fast on a 120Hz panel, and it visibly lingers
     on a device that has dropped to 30fps. Exponential damping against real elapsed time makes
     the settle take the same wall-clock duration everywhere. */
  const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

  gsap.ticker.add((time, deltaMs) => {
    // field.disposed goes true if the watchdog steps down to 'off' or the context is lost;
    // there is nothing left to ease toward once that happens.
    if (document.hidden || field.disposed) return;
    // gsap.ticker's 2nd argument is the frame delta in *milliseconds* (its 1st is elapsed
    // seconds). Verified against wall-clock on 3.12.5: summed deltas track performance.now() 1:1.
    const dt = Math.min(deltaMs / 1000, 0.05);          // clamp so a stalled tab can't jump

    dispRaw *= Math.exp(-9 * dt);
    const d = uniforms.uDispersion;
    d.value += (dispRaw - d.value) * damp(7, dt);
    if (d.value < 0.0005) d.value = 0;

    const kCol = damp(4, dt);
    colA.lerp(tgtA, kCol);
    colB.lerp(tgtB, kCol);
    uniforms.uColorA.value.copy(colA);
    uniforms.uColorB.value.copy(colB);

    camera.position.lerp(camTarget, damp(3, dt));
    camera.lookAt(0, 0, 0);
  });

  window.__gl.linked = true;
}
