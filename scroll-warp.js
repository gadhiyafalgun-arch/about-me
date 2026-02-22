/**
 * scroll-warp.js
 * Spaceship scroll effect — elements become asteroids, zoom in, shake on collision,
 * then the next section materialises from the void.
 */
(function () {
  'use strict';

  /* ─────────────────────────────────────────
   * CONFIG
   * ───────────────────────────────────────── */
  const CFG = {
    zoomScale: 2.8,          // how much sections zoom into you
    zoomDuration: 0.9,       // seconds for zoom
    warpSpeed: 0.016,        // warp-line speed multiplier
    shakeIntensity: 12,      // px shake on collision
    shakeDuration: 400,      // ms
    asteroidCount: 18,
    starCount: 180,
    collisionChance: 0.55,   // probability a section change triggers shake
    nextSectionDelay: 60,    // ms before next section appears
  };

  /* ─────────────────────────────────────────
   * STATE
   * ───────────────────────────────────────── */
  let warpCanvas, warpCtx, W, H;
  let stars = [], asteroids = [];
  let warpActive = false, warpSpeed = 0;
  let shakePending = false, shakeStart = 0;
  let raf;
  let lastScrollY = window.scrollY;
  let isTransitioning = false;
  let transitioning = false;
  let scrollVelocity = 0, lastScrollT = performance.now();

  /* ─────────────────────────────────────────
   * WARP CANVAS SETUP
   * ───────────────────────────────────────── */
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

  /* ─────────────────────────────────────────
   * STARS (warp lines)
   * ───────────────────────────────────────── */
  function buildStars () {
    stars = [];
    for (let i = 0; i < CFG.starCount; i++) stars.push(newStar());
  }

  function newStar (born) {
    const angle = Math.random() * Math.PI * 2;
    const dist  = 10 + Math.random() * 60;
    return {
      x: W / 2 + Math.cos(angle) * dist,
      y: H / 2 + Math.sin(angle) * dist,
      ox: W / 2 + Math.cos(angle) * dist,
      oy: H / 2 + Math.sin(angle) * dist,
      angle,
      speed: 0.4 + Math.random() * 1.5,
      alpha: born ? 0 : Math.random(),
      len: 0,
    };
  }

  function updateStars (dt) {
    const spd = warpSpeed;
    stars.forEach(s => {
      const dx = W / 2, dy = H / 2;
      const vx = (s.x - dx), vy = (s.y - dy);
      const mag = Math.sqrt(vx * vx + vy * vy) || 1;
      s.x += (vx / mag) * s.speed * spd * dt * 0.06;
      s.y += (vy / mag) * s.speed * spd * dt * 0.06;
      s.len = Math.min(spd * 0.5, 60);
      s.alpha = Math.min(s.alpha + 0.02, spd / 60);
      if (s.x < 0 || s.x > W || s.y < 0 || s.y > H) {
        Object.assign(s, newStar(true));
        s.alpha = 0;
      }
    });
  }

  function drawStars () {
    stars.forEach(s => {
      if (s.alpha <= 0.01) return;
      const dx = s.x - (W / 2), dy = s.y - (H / 2);
      const mag = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = dx / mag, ny = dy / mag;
      warpCtx.beginPath();
      warpCtx.moveTo(s.x - nx * s.len * 0.4, s.y - ny * s.len * 0.4);
      warpCtx.lineTo(s.x, s.y);
      const grad = warpCtx.createLinearGradient(
        s.x - nx * s.len * 0.4, s.y - ny * s.len * 0.4, s.x, s.y
      );
      grad.addColorStop(0, `rgba(0,255,224,0)`);
      grad.addColorStop(1, `rgba(0,255,224,${(s.alpha * 0.8).toFixed(3)})`);
      warpCtx.strokeStyle = grad;
      warpCtx.lineWidth = 0.8 + (warpSpeed / 80);
      warpCtx.stroke();
    });
  }

  /* ─────────────────────────────────────────
   * ASTEROIDS
   * ───────────────────────────────────────── */
  function buildAsteroids () {
    asteroids = [];
    for (let i = 0; i < CFG.asteroidCount; i++) asteroids.push(newAsteroid());
  }

  function newAsteroid () {
    const edge = Math.floor(Math.random() * 4);
    let x, y;
    if (edge === 0) { x = Math.random() * W; y = -60; }
    else if (edge === 1) { x = W + 60; y = Math.random() * H; }
    else if (edge === 2) { x = Math.random() * W; y = H + 60; }
    else { x = -60; y = Math.random() * H; }
    const angle = Math.atan2(H / 2 - y, W / 2 - x) + (Math.random() - 0.5) * 1.2;
    const sides = 5 + Math.floor(Math.random() * 5);
    const r = 6 + Math.random() * 22;
    const verts = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      verts.push({ a, r: r * (0.7 + Math.random() * 0.5) });
    }
    return {
      x, y, angle, verts,
      rot: (Math.random() - 0.5) * 0.04,
      currentRot: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 1.2,
      alpha: 0.15 + Math.random() * 0.25,
      dead: false,
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
      warpCtx.lineWidth = 1;
      warpCtx.stroke();
      warpCtx.restore();
    });
  }

  /* ─────────────────────────────────────────
   * SHAKE
   * ───────────────────────────────────────── */
  function triggerShake () {
    shakeStart = performance.now();
    shakePending = true;
  }

  function applyShake (now) {
    if (!shakePending) {
      document.body.style.transform = '';
      return;
    }
    const elapsed = now - shakeStart;
    if (elapsed > CFG.shakeDuration) {
      document.body.style.transform = '';
      shakePending = false;
      return;
    }
    const decay = 1 - elapsed / CFG.shakeDuration;
    const i = CFG.shakeIntensity * decay;
    const ox = (Math.random() - 0.5) * i;
    const oy = (Math.random() - 0.5) * i;
    document.body.style.transform = `translate(${ox}px,${oy}px)`;
  }

  /* ─────────────────────────────────────────
   * SECTION ZOOM TRANSITION
   * ───────────────────────────────────────── */
  function getSections () {
    return [...document.querySelectorAll('section[id], .cat-section[id]')];
  }

  function getActiveSection () {
    const mid = window.scrollY + window.innerHeight * 0.45;
    const secs = getSections();
    for (let i = secs.length - 1; i >= 0; i--) {
      if (secs[i].offsetTop <= mid) return secs[i];
    }
    return secs[0];
  }

  /* Zoom-out current section, shake if lucky, zoom-in next */
  function doZoomTransition (fromEl, toEl) {
    if (transitioning) return;
    transitioning = true;

    // Warp speed burst
    warpSpeed = 80;
    warpCanvas.style.opacity = '0.92';

    // Zoom out from section
    if (fromEl) {
      fromEl.style.transition = `transform ${CFG.zoomDuration * 0.5}s cubic-bezier(.4,0,.2,1), opacity ${CFG.zoomDuration * 0.5}s ease`;
      fromEl.style.transform = `scale(${CFG.zoomScale}) translateZ(0)`;
      fromEl.style.opacity = '0';
    }

    // Optional shake
    if (Math.random() < CFG.collisionChance) {
      setTimeout(triggerShake, 180);
    }

    // Bring in next section
    const delay = CFG.zoomDuration * 500;
    setTimeout(() => {
      if (fromEl) { fromEl.style.transition = ''; fromEl.style.transform = ''; fromEl.style.opacity = ''; }

      if (toEl) {
        toEl.style.transition = 'none';
        toEl.style.transform = `scale(0.18) translateZ(0)`;
        toEl.style.opacity = '0';
        toEl.offsetHeight; // reflow
        toEl.style.transition = `transform ${CFG.zoomDuration}s cubic-bezier(.16,1,.3,1), opacity ${CFG.zoomDuration * 0.6}s ease`;
        toEl.style.transform = 'scale(1) translateZ(0)';
        toEl.style.opacity = '1';
      }

      // Decelerate warp
      let dec = 80;
      const decelInt = setInterval(() => {
        dec *= 0.88;
        warpSpeed = dec;
        if (dec < 1.5) {
          warpSpeed = 0;
          warpCanvas.style.opacity = '0';
          clearInterval(decelInt);
          setTimeout(() => { transitioning = false; }, 300);
        }
      }, 40);
    }, delay);
  }

  /* ─────────────────────────────────────────
   * SCROLL DETECTION
   * ───────────────────────────────────────── */
  let prevActive = null;

  function onScroll () {
    const now = performance.now();
    const dy = window.scrollY - lastScrollY;
    const dt = Math.max(now - lastScrollT, 1);
    scrollVelocity = Math.abs(dy / dt) * 1000; // px/s
    lastScrollY = window.scrollY;
    lastScrollT = now;

    // Gentle warp proportional to velocity
    warpSpeed = Math.min(scrollVelocity * 0.12, 75);
    if (warpSpeed > 4) {
      warpCanvas.style.opacity = String(Math.min(warpSpeed / 75 * 0.85, 0.85));
    } else {
      warpCanvas.style.opacity = '0';
    }

    const cur = getActiveSection();
    if (cur && cur !== prevActive) {
      doZoomTransition(prevActive, null); // lighter: only zoom out, let natural scroll handle new
      prevActive = cur;
    }
  }

  /* ─────────────────────────────────────────
   * RENDER LOOP
   * ───────────────────────────────────────── */
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
    raf = requestAnimationFrame(loop);
  }

  /* ─────────────────────────────────────────
   * SECTION APPEAR-FROM-FAR
   * ───────────────────────────────────────── */
  function setupSectionReveal () {
    const secs = getSections();
    // Skip hero (#home)
    secs.forEach((sec, idx) => {
      if (sec.id === 'home') return;
      sec.style.willChange = 'transform, opacity';

      const io = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting && !sec._warpRevealed) {
            sec._warpRevealed = true;
            // Start tiny and far, fly in
            sec.style.transition = 'none';
            sec.style.transform = 'scale(0.22) translateZ(0)';
            sec.style.opacity = '0';
            sec.offsetHeight;
            sec.style.transition = 'transform .95s cubic-bezier(.16,1,.3,1), opacity .7s ease';
            sec.style.transform = 'scale(1) translateZ(0)';
            sec.style.opacity = '1';
            io.disconnect();
          }
        });
      }, { threshold: 0.05 });
      io.observe(sec);
    });
  }

  /* ─────────────────────────────────────────
   * TILE HOVER REFLECTION
   * ───────────────────────────────────────── */
  function setupTileReflection () {
    const tiles = document.querySelectorAll('.project-slot, .physics-card, .strip-stat, .contact-link');
    tiles.forEach(tile => {
      // Create shimmer overlay
      const shimmer = document.createElement('div');
      Object.assign(shimmer.style, {
        position: 'absolute', inset: '0',
        background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.07) 50%, transparent 60%)',
        transform: 'translateX(-100%)',
        pointerEvents: 'none',
        transition: 'transform 0s',
        zIndex: '10',
      });
      tile.style.position = 'relative';
      tile.style.overflow = 'hidden';
      tile.appendChild(shimmer);

      tile.addEventListener('mousemove', e => {
        const r = tile.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        // Tilt
        const tiltX = (y - 0.5) * 10;
        const tiltY = (x - 0.5) * -10;
        tile.style.transform = `perspective(600px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(1.03)`;
        tile.style.transition = 'transform .1s ease';
        // Reflection sweep
        shimmer.style.transition = 'transform .15s ease';
        shimmer.style.transform = `translateX(${(x * 2 - 1) * 120}%)`;
      });

      tile.addEventListener('mouseleave', () => {
        tile.style.transition = 'transform .5s cubic-bezier(.16,1,.3,1)';
        tile.style.transform = '';
        shimmer.style.transition = 'transform .4s ease';
        shimmer.style.transform = 'translateX(100%)';
      });
    });
  }

  /* ─────────────────────────────────────────
   * INIT
   * ───────────────────────────────────────── */
  function init () {
    createWarpCanvas();
    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    prevActive = getActiveSection();
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
