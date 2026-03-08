/* ═══════════════════════════════════════════════════════
   cursor-animation.js  —  Cursor glow blob
   - Follows mouse with smooth lerp
   - Grows/shrinks based on which scene is active
   ═══════════════════════════════════════════════════════ */

(function initCursor() {
  const glow = document.getElementById('cursorGlow');
  if (!glow) return;

  let mx = window.innerWidth  / 2;
  let my = window.innerHeight / 2;
  let cx = mx, cy = my;

  // Current animated values
  let gSize    = 400;
  let gOpacity = 0.05;

  // Target values (updated when a scene enters view)
  let tSize    = 400;
  let tOpacity = 0.05;

  // Per-scene glow config
  const sectionMap = {
    s0:  { size: 400, opacity: 0.05 },
    s2:  { size: 620, opacity: 0.13 },
    s3:  { size: 580, opacity: 0.11 },
    s4:  { size: 580, opacity: 0.11 },
    s5:  { size: 560, opacity: 0.10 },
    s6:  { size: 560, opacity: 0.10 },
    s7:  { size: 440, opacity: 0.06 },
    s8:  { size: 440, opacity: 0.06 },
    s9:  { size: 400, opacity: 0.05 },
    s10: { size: 500, opacity: 0.09 },
  };

  // Watch each scene and update targets on enter
  Object.entries(sectionMap).forEach(([id, cfg]) => {
    const el = document.getElementById(id);
    if (!el) return;
    new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        tSize    = cfg.size;
        tOpacity = cfg.opacity;
      }
    }, { threshold: 0.3 }).observe(el);
  });

  // Track mouse
  document.addEventListener('mousemove', e => {
    mx = e.clientX;
    my = e.clientY;
  }, { passive: true });

  // Animation loop — lerp position + size + opacity
  function loop() {
    cx      += (mx - cx)           * 0.12;
    cy      += (my - cy)           * 0.12;
    gSize   += (tSize    - gSize)  * 0.06;
    gOpacity+= (tOpacity - gOpacity) * 0.06;

    const half = gSize / 2;
    glow.style.transform  = `translate(${cx - half}px, ${cy - half}px)`;
    glow.style.width      = gSize + 'px';
    glow.style.height     = gSize + 'px';
    glow.style.background = `radial-gradient(circle, rgba(0,255,224,${gOpacity.toFixed(3)}) 0%, transparent 70%)`;

    requestAnimationFrame(loop);
  }
  loop();
})();
