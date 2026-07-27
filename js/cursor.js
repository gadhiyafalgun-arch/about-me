/* ═══════════════════════════════════════════════════════
   js/cursor.js — custom cursor + ambient glow.

   Replaces cursor-animation.js (glow, own rAF loop) and target-cursor.js (spinning corner
   brackets, own GSAP tweens per corner). Both are now one ring-and-dot pair updated from the
   shared gsap.ticker.

   The brackets are gone on purpose: a rotating four-corner reticle is a recognisable
   off-the-shelf component, and it read as bolted-on rather than designed. A lagging ring that
   swells over interactive elements says the same thing more quietly.
   ═══════════════════════════════════════════════════════ */
'use strict';
(() => {
  const glow = document.getElementById('cursorGlow');

  const coarse  = window.matchMedia('(pointer: coarse)').matches;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* No custom cursor without a real pointer or without GSAP to drive it. The `cursor: none` rule
     is gated on the class this sets, so bailing here leaves the native cursor in place rather
     than leaving the visitor with no pointer at all. */
  if (coarse || typeof gsap === 'undefined') {
    if (glow) glow.style.display = 'none';
    return;
  }
  document.documentElement.classList.add('custom-cursor');

  /* ── Elements ── */
  const ring = document.createElement('div');
  const dot  = document.createElement('div');
  ring.className = 'fg-cursor-ring';
  dot.className  = 'fg-cursor-dot';
  document.body.append(ring, dot);

  /* ── State ── */
  let mx = window.innerWidth / 2, my = window.innerHeight / 2;
  let rx = mx, ry = my, dx = mx, dy = my;
  let ringScale = 1, ringScaleTarget = 1;

  // Ambient glow: size and opacity per section, same values the old file used.
  const GLOW = {
    s0: [400, 0.05], s2: [620, 0.13], s3: [580, 0.11], s4: [580, 0.11], s5: [560, 0.10],
    s6: [560, 0.10], s7: [440, 0.06], s8: [440, 0.06], s9: [400, 0.05], s10: [500, 0.09],
  };
  let gSize = 400, gOpacity = 0.05, tSize = 400, tOpacity = 0.05;

  Object.entries(GLOW).forEach(([id, [size, opacity]]) => {
    const el = document.getElementById(id);
    if (!el) return;
    new IntersectionObserver(e => {
      if (e[0].isIntersecting) { tSize = size; tOpacity = opacity; }
    }, { threshold: 0.3 }).observe(el);
  });

  /* ── Input ── */
  window.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; }, { passive: true });
  window.addEventListener('mousedown', () => { ringScaleTarget *= 0.8; }, { passive: true });
  window.addEventListener('mouseup',   () => { ringScaleTarget = hovering ? 1.9 : 1; }, { passive: true });
  document.addEventListener('mouseleave', () => { ring.style.opacity = '0'; dot.style.opacity = '0'; });
  document.addEventListener('mouseenter', () => { ring.style.opacity = '1'; dot.style.opacity = '1'; });

  /* Interactive targets swell the ring. Delegated so elements added later still work.

     mouseover/mouseout bubble, so moving between two children of the same target (a
     .project-slot holds a tag, a title, a stack line and mini-fx's shimmer div) would otherwise
     fire mouseout and immediately mouseover again — the ring would pulse and the border-colour
     transition would restart every time the pointer crossed an internal boundary. Comparing
     against relatedTarget ignores moves that never actually leave the element. */
  let hovering = false;
  const INTERACTIVE = '.cursor-target, a, button';

  document.addEventListener('mouseover', e => {
    const el = e.target.closest(INTERACTIVE);
    if (!el || hovering) return;
    hovering = true; ringScaleTarget = 1.9; ring.classList.add('is-active');
  }, { passive: true });

  document.addEventListener('mouseout', e => {
    const el = e.target.closest(INTERACTIVE);
    if (!el) return;
    // Still inside the same interactive element (or a nested one) — not a real exit.
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    // Moved straight from one interactive element into another — stay swollen.
    if (e.relatedTarget && e.relatedTarget.closest?.(INTERACTIVE)) return;
    hovering = false; ringScaleTarget = 1; ring.classList.remove('is-active');
  }, { passive: true });

  /* ── One update, on the shared ticker ──
     Time-based damping, so the follow distance is the same at 30, 60 or 120fps. Frame-rate
     dependent lerps make a custom cursor feel loose on slow machines and glued on fast ones. */
  const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

  gsap.ticker.add((time, deltaMs) => {
    if (document.hidden) return;
    // gsap.ticker's 2nd argument is the frame delta in *milliseconds* (its 1st is elapsed
    // seconds). Verified against wall-clock on 3.12.5: summed deltas track performance.now() 1:1.
    const dt = Math.min(deltaMs / 1000, 0.05);

    // The dot tracks almost exactly; the ring trails it. That gap is the whole effect.
    const kDot  = reduced ? 1 : damp(28, dt);
    const kRing = reduced ? 1 : damp(11, dt);
    dx += (mx - dx) * kDot;  dy += (my - dy) * kDot;
    rx += (mx - rx) * kRing; ry += (my - ry) * kRing;
    ringScale += (ringScaleTarget - ringScale) * damp(14, dt);

    dot.style.transform  = `translate3d(${dx}px, ${dy}px, 0) translate(-50%, -50%)`;
    ring.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%) scale(${ringScale.toFixed(3)})`;

    if (glow) {
      const kG = damp(3, dt);
      gSize    += (tSize - gSize) * kG;
      gOpacity += (tOpacity - gOpacity) * kG;
      const half = gSize / 2;
      glow.style.transform  = `translate3d(${rx - half}px, ${ry - half}px, 0)`;
      glow.style.width      = gSize + 'px';
      glow.style.height     = gSize + 'px';
      glow.style.background = `radial-gradient(circle, rgba(0,255,224,${gOpacity.toFixed(3)}) 0%, transparent 70%)`;
    }
  });
})();
