/* ═══════════════════════════════════════════════════════
   js/gl/boot.js — entry point for the WebGL background.

   Three.js has been ESM-only since r161, so it is resolved through the import map in index.html
   rather than a global. Everything WebGL hangs off this module.
   ═══════════════════════════════════════════════════════ */

import { initScene } from './scene.js';
import { linkScroll } from './scroll-link.js';

const field = initScene();

if (field) {
  window.__field = field;
  linkScroll(field);
  // Scene heights were set by scroll-animation.js; make sure the triggers created here measure
  // against the final layout.
  ScrollTrigger.refresh();
}
