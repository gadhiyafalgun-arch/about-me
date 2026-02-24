/**
 * scroll-warp.js — Spaceship scroll effect
 * FIXED: sections no longer jump vertically.
 * Zoom effect uses perspective + scale only, keeping
 * everything anchored at its natural vertical position.
 */
(function () {
  'use strict';

  const CFG = {
    warpSpeed:       0.016,
    shakeIntensity:  10,
    shakeDuration:   380,
    asteroidCount:   18,
    starCount:       180,
    collisionChance: 0.5,
    revealDuration:  '1.1s',
    revealEase:      'cubic-bezier(0.16, 1, 0.3, 1)',
  };

  let warpCanvas, warpCtx, W, H;
  let stars = [], asteroids = [];
  let warpSpeed = 0;
  let shakePending = false, shakeStart = 0;
  let lastScrollY = window.scrollY;
  let scrollVelocity = 0, lastScrollT = performance.now();

  /* ── WARP CANVAS ── */
  function createWarpCanvas () {
    warpCanvas = document.createElement('canvas');
    warpCanvas.id = 'warpCanvas';
    Object.assign(warpCanvas.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100vw', height: '100vh',
      zIndex: '9', pointerEvents: 'none',
      opacity: '0', transition: 'opacity .3s ease',
    });
    document.body.appendChild(warpCanvas);
    warpCtx = warpCanvas.getContext('2d');
    resize();
  }

  function resize () {
    if (!warpCanvas) return;
    W = warpCanvas.width  = window.innerWidth;
    H = warpCanvas.height = window.innerHeight;
    buildStars();
    buildAsteroids();
  }

  /* ── STARS ── */
  function buildStars () {
    stars = [];
    for (let i = 0; i < CFG.starCount; i++) stars.push(newStar(false));
  }

  function newStar (born) {
    const angle = Math.random() * Math.PI * 2;
    const dist  = 10 + Math.random() * 60;
    return {
      x: W / 2 + Math.cos(angle) * dist,
      y: H / 2 + Math.sin(angle) * dist,
      angle,
      speed: 0.4 + Math.random() * 1.5,
      alpha: born ? 0 : Math.random(),
      len:   0,
    };
  }

  function updateStars (dt) {
    const spd = warpSpeed;
    stars.forEach(s => {
      const vx = s.x - W / 2, vy = s.y - H / 2;
      const mag = Math.sqrt(vx * vx + vy * vy) || 1;
      s.x += (vx / mag) * s.speed * spd * dt * 0.06;
      s.y += (vy / mag) * s.speed * spd * dt * 0.06;
      s.len   = Math.min(spd * 0.5, 60);
      s.alpha = Math.min(s.alpha + 0.02, spd / 60);
      if (s.x < 0 || s.x > W || s.y < 0 || s.y > H) {
        Object.assign(s, newStar(true));
      }
    });
  }

  function drawStars () {
    stars.forEach(s => {
      if (s.alpha <= 0.01) return;
      const dx = s.x - W / 2, dy = s.y - H / 2;
      const mag = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = dx / mag, ny = dy / mag;
      const grad = warpCtx.createLinearGradient(
        s.x - nx * s.len * 0.4, s.y - ny * s.len * 0.4, s.x, s.y
      );
      grad.addColorStop(0, `rgba(0,255,224,0)`);
      grad.addColorStop(1, `rgba(0,255,224,${(s.alpha * 0.8).toFixed(3)})`);
      warpCtx.beginPath();
      warpCtx.moveTo(s.x - nx * s.len * 0.4, s.y - ny * s.len * 0.4);
      warpCtx.lineTo(s.x, s.y);
      warpCtx.strokeStyle = grad;
      warpCtx.lineWidth   = 0.8 + warpSpeed / 80;
      warpCtx.stroke();
    });
  }

  /* ── ASTEROIDS ── */
  function buildAsteroids () {
    asteroids = [];
    for (let i = 0; i < CFG.asteroidCount; i++) asteroids.push(newAsteroid());
  }

  function newAsteroid () {
    const edge = Math.floor(Math.random() * 4);
    let x, y;
    if      (edge === 0) { x = Math.random() * W; y = -60; }
    else if (edge === 1) { x = W + 60;             y = Math.random() * H; }
    else if (edge === 2) { x = Math.random() * W; y = H + 60; }
    else                 { x = -60;                y = Math.random() * H; }
    const angle = Math.atan2(H / 2 - y, W / 2 - x) + (Math.random() - 0.5) * 1.2;
    const sides = 5 + Math.floor(Math.random() * 5);
    const r     = 6 + Math.random() * 22;
    const verts = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      verts.push({ a, r: r * (0.7 + Math.random() * 0.5) });
    }
    return {
      x, y, angle, verts,
      rot:        (Math.random() - 0.5) * 0.04,
      currentRot: Math.random() * Math.PI * 2,
      speed:      0.5 + Math.random() * 1.2,
      alpha:      0.15 + Math.random() * 0.25,
    };
  }

  function updateAsteroids (dt) {
    asteroids.forEach(a => {
      a.x += Math.cos(a.angle) * a.speed * (warpSpeed / 20) * dt * 0.03;
      a.y += Math.sin(a.angle) * a.speed * (warpSpeed / 20) * dt * 0.03;
      a.currentRot += a.rot;
      if (a.x < -100 || a.x > W + 100 || a.y < -100 || a.y > H + 100) {
        Object.assign(a, newAsteroid());
      }
    });
  }

  function drawAsteroids () {
    if (warpSpeed < 8) return;
    const t = warpSpeed / 80;
    asteroids.forEach(a => {
      warpCtx.save();
      warpCtx.translate(a.x, a.y);
      warpCtx.rotate(a.currentRot);
      warpCtx.beginPath();
      a.verts.forEach((v, i) => {
        const px = Math.cos(v.a) * v.r, py = Math.sin(v.a) * v.r;
        i === 0 ? warpCtx.moveTo(px, py) : warpCtx.lineTo(px, py);
      });
      warpCtx.closePath();
      warpCtx.strokeStyle = `rgba(0,255,224,${(a.alpha * t).toFixed(3)})`;
      warpCtx.lineWidth   = 1;
      warpCtx.stroke();
      warpCtx.restore();
    });
  }

  /* ── SHAKE ── */
  function triggerShake () {
    shakeStart   = performance.now();
    shakePending = true;
  }

  function applyShake (now) {
    if (!shakePending) { document.body.style.transform = ''; return; }
    const elapsed = now - shakeStart;
    if (elapsed > CFG.shakeDuration) {
      document.body.style.transform = '';
      shakePending = false;
      return;
    }
    const decay = 1 - elapsed / CFG.shakeDuration;
    const i = CFG.shakeIntensity * decay;
    document.body.style.transform = `translate(${(Math.random()-0.5)*i}px,${(Math.random()-0.5)*i}px)`;
  }

  /* ────────────────────────────────────────────────────────
   * SECTION REVEAL  —  "travelling through space"
   *
   * THE FIX explained:
   * The old code set `transform: scale(0.22)` directly on
   * the <section> element. CSS scale shrinks the element
   * toward its own center, which causes layout reflow and
   * makes it appear to "jump up" because it collapses in
   * height too.
   *
   * New approach:
   * 1. The <section> itself keeps its natural size/position
   *    in the document — NO transforms on it ever.
   * 2. We wrap inner content in a `.warp-scaler` div.
   * 3. `.warp-scaler` uses `scale3d` + `perspective` so it
   *    shrinks visually but the section box stays full size,
   *    meaning the page layout never shifts.
   * 4. Blur starts at 8px and clears → "coming from far away"
   * ────────────────────────────────────────────────────── */
  function setupSectionReveal () {
    const secs = [...document.querySelectorAll('section[id], .cat-section[id]')];

    secs.forEach(sec => {
      if (sec.id === 'home') return;

      /* ── Build wrapper structure ──
         section (unchanged, holds layout space)
           └── .warp-shell  (perspective container)
                 └── .warp-scaler  (what actually animates)
                       └── [original content]
      */
      const shell = document.createElement('div');
      shell.className = 'warp-shell';
      Object.assign(shell.style, {
        perspective:       '1400px',
        perspectiveOrigin: '50% 50%',
        width:             '100%',
        height:            '100%',
      });

      const scaler = document.createElement('div');
      scaler.className = 'warp-scaler';
      Object.assign(scaler.style, {
        /* Start: tiny dot in the distance, slightly blurred */
        transform:  'scale3d(0.15, 0.15, 0.15)',
        opacity:    '0',
        filter:     'blur(10px)',
        transition: 'none',
        width:      '100%',
        willChange: 'transform, opacity, filter',
      });

      /* Lift all children of <section> into scaler */
      while (sec.firstChild) scaler.appendChild(sec.firstChild);
      shell.appendChild(scaler);
      sec.appendChild(shell);

      /* Observe section entering viewport */
      const io = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (!e.isIntersecting || sec._warpRevealed) return;
          sec._warpRevealed = true;
          io.disconnect();

          /* Force reflow so "none" registers before we switch */
          scaler.offsetHeight;

          /* Engage the zoom-in */
          scaler.style.transition = [
            `transform ${CFG.revealDuration} ${CFG.revealEase}`,
            `opacity 0.65s ease 0.05s`,
            `filter 0.85s ease`,
          ].join(', ');

          scaler.style.transform = 'scale3d(1, 1, 1)';
          scaler.style.opacity   = '1';
          scaler.style.filter    = 'blur(0px)';

          /* Collision shake */
          if (Math.random() < CFG.collisionChance) {
            setTimeout(triggerShake, 320);
          }

          /* Clean up */
          setTimeout(() => {
            scaler.style.willChange = 'auto';
            scaler.style.transition = '';
          }, 1300);
        });
      }, { threshold: 0.04, rootMargin: '0px 0px -30px 0px' });

      io.observe(sec);
    });
  }

  /* ── SCROLL → WARP LINES ── */
  function onScroll () {
    const now = performance.now();
    const dy  = window.scrollY - lastScrollY;
    const dt  = Math.max(now - lastScrollT, 1);
    scrollVelocity = Math.abs(dy / dt) * 1000;
    lastScrollY    = window.scrollY;
    lastScrollT    = now;

    warpSpeed = Math.min(scrollVelocity * 0.10, 75);
    warpCanvas.style.opacity = warpSpeed > 5
      ? String(Math.min(warpSpeed / 75 * 0.8, 0.8))
      : '0';
  }

  /* ── TILE HOVER REFLECTION ── */
  function setupTileReflection () {
    const tiles = document.querySelectorAll(
      '.project-slot, .physics-card, .strip-stat, .contact-link'
    );
    tiles.forEach(tile => {
      const shimmer = document.createElement('div');
      Object.assign(shimmer.style, {
        position:      'absolute', inset: '0',
        background:    'linear-gradient(105deg,transparent 40%,rgba(255,255,255,0.08) 50%,transparent 60%)',
        transform:     'translateX(-100%)',
        pointerEvents: 'none',
        zIndex:        '10',
      });
      tile.style.position = 'relative';
      tile.style.overflow = 'hidden';
      tile.appendChild(shimmer);

      tile.addEventListener('mousemove', e => {
        const r     = tile.getBoundingClientRect();
        const x     = (e.clientX - r.left) / r.width;
        const y     = (e.clientY - r.top)  / r.height;
        tile.style.transition = 'transform .1s ease';
        tile.style.transform  = `perspective(600px) rotateX(${(y-.5)*10}deg) rotateY(${(x-.5)*-10}deg) scale(1.03)`;
        shimmer.style.transition = 'transform .15s ease';
        shimmer.style.transform  = `translateX(${(x*2-1)*120}%)`;
      });
      tile.addEventListener('mouseleave', () => {
        tile.style.transition = 'transform .5s cubic-bezier(.16,1,.3,1)';
        tile.style.transform  = '';
        shimmer.style.transition = 'transform .4s ease';
        shimmer.style.transform  = 'translateX(100%)';
      });
    });
  }

  /* ── HERO SCROLL ZOOM ──
   * Pins the hero via CSS sticky (height:220vh wrapper).
   * Maps scroll progress (0→1) inside the zone to:
   *   scale  1.0 → 1.8  (zoom in)
   *   opacity 1.0 → 0.0  (fade out in last 30%)
   * Fully reversible — scroll back up → zoom reverses.
   */
  function setupHeroZoom () {
    const zone  = document.getElementById('hero-scroll-zone');
    const inner = document.querySelector('.hero-zoom-inner');
    if (!zone || !inner) return;

    function updateZoom () {
      const zoneTop    = zone.offsetTop;
      const zoneHeight = zone.offsetHeight;          // 220vh
      const viewH      = window.innerHeight;
      const scrollable = zoneHeight - viewH;         // 120vh of zoom travel
      if (scrollable <= 0) return;

      const scrolled  = Math.max(0, Math.min(scrollable, window.scrollY - zoneTop));
      const progress  = scrolled / scrollable;       // 0 → 1

      /* Scale: 1.0 at start, 1.8 at full scroll */
      const scale   = 1 + progress * 0.8;

      /* Fade out in the last 30% of the scroll zone */
      const opacity = progress > 0.70
        ? Math.max(0, 1 - (progress - 0.70) / 0.30)
        : 1;

      inner.style.transform = `scale(${scale.toFixed(4)})`;
      inner.style.opacity   = opacity.toFixed(4);
    }

    window.addEventListener('scroll', updateZoom, { passive: true });
    updateZoom(); /* run once on load */
  }

  /* ── RENDER LOOP ── */
  let lastT = performance.now();
  function loop (now) {
    const dt = now - lastT; lastT = now;
    warpCtx.clearRect(0, 0, W, H);
    if (warpSpeed > 0.5) {
      updateStars(dt);
      updateAsteroids(dt);
      drawStars();
      drawAsteroids();
    }
    applyShake(now);
    requestAnimationFrame(loop);
  }

  /* ── INIT ── */
  function init () {
    createWarpCanvas();
    window.addEventListener('resize', resize,   { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    setupHeroZoom();
    setupSectionReveal();
    setupTileReflection();
    loop(performance.now());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
