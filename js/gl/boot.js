/* ═══════════════════════════════════════════════════════
   js/gl/boot.js — entry point for the WebGL background.

   Three.js has been ESM-only since r161, so it is resolved through the import map in index.html
   rather than a global. Everything WebGL hangs off this module.
   ═══════════════════════════════════════════════════════ */

import { initScene } from './scene.js';
import { linkScroll } from './scroll-link.js';

/* The field renders from gsap.ticker and is driven by ScrollTrigger, so it cannot start without
   them. Mirrors the guard in scroll-animation.js: if the libraries are missing, fall back to the
   static gradient (html.gl-off) instead of throwing partway through setup and leaving a live but
   never-rendered WebGL context behind. */
if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') {
  console.warn('[gl] GSAP/ScrollTrigger unavailable — point field disabled, static background shown.');
  document.documentElement.classList.add('gl-off');
} else {
  const field = initScene();
  if (field) {
    window.__field = field;
    linkScroll(field);
    // Scene heights were set by scroll-animation.js; make sure the triggers created here measure
    // against the final layout.
    ScrollTrigger.refresh();
  }
}
