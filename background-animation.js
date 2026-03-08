/* ═══════════════════════════════════════════════════════
   background-animation.js
   Contains 3 independent systems:
     1. Antigravity particle field  (#antigravity)  — Three.js
        + scroll-blast warp mode
     2. Hero floating particles + expanding circles
     3. Per-category canvas (quant/physics/ml/data/auto)
   ═══════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────
   1. ANTIGRAVITY PARTICLE FIELD  (Three.js WebGL)
   300 capsule-shaped instanced particles.
   IDLE:    Magnetic ring around cursor, wave + pulse.
   SCROLL:  Particles blast toward the viewer (warp streaks).
   Smooth blend between modes via scroll velocity.
───────────────────────────────────────────────────── */
(function initAntigravity() {
  const canvas = document.getElementById('antigravity');
  if (!canvas || typeof THREE === 'undefined') return;

  /* ── Config ── */
  const CFG = {
    count:            300,
    magnetRadius:     6,
    ringRadius:       7,
    waveSpeed:        0.4,
    waveAmplitude:    1,
    particleSize:     1.5,
    lerpSpeed:        0.05,
    autoAnimate:      true,
    particleVariance: 1,
    rotationSpeed:    0,
    depthFactor:      1,
    pulseSpeed:       3,
    fieldStrength:    10,
  };

  /* ── Three.js setup ── */
  const scene    = new THREE.Scene();
  const camera   = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0, 50);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const geometry = THREE.CapsuleGeometry
    ? new THREE.CapsuleGeometry(0.1, 0.4, 4, 8)
    : new THREE.SphereGeometry(0.2, 16, 16);

  const material = new THREE.MeshBasicMaterial({ color: 0x29fbff });
  const mesh     = new THREE.InstancedMesh(geometry, material, CFG.count);
  scene.add(mesh);

  const dummy = new THREE.Object3D();

  /* ── Viewport in world units ── */
  function getViewport() {
    const vFov   = (camera.fov * Math.PI) / 180;
    const height = 2 * Math.tan(vFov / 2) * camera.position.z;
    return { width: height * camera.aspect, height };
  }

  /* ── Scroll velocity tracker ── */
  let scrollSpeed = 0;
  let lastScrollY = window.scrollY;
  window.addEventListener('scroll', () => {
    const dy = Math.abs(window.scrollY - lastScrollY);
    scrollSpeed = Math.min(dy, 200);
    lastScrollY = window.scrollY;
  }, { passive: true });

  /* ── Particles ── */
  let vp = getViewport();
  const particles = [];
  for (let i = 0; i < CFG.count; i++) {
    const x = (Math.random() - 0.5) * vp.width;
    const y = (Math.random() - 0.5) * vp.height;
    const z = (Math.random() - 0.5) * 20;
    particles.push({
      t: Math.random() * 100,
      speed: 0.01 + Math.random() / 200,
      mx: x, my: y, mz: z,
      cx: x, cy: y, cz: z,
      randomRadiusOffset: (Math.random() - 0.5) * 2,
    });
  }

  /* ── Mouse ── */
  const mouseNDC       = { x: 0, y: 0 };
  const virtualMouse   = { x: 0, y: 0 };
  const lastMousePos   = { x: 0, y: 0 };
  let   lastMouseMove  = 0;

  document.addEventListener('mousemove', e => {
    mouseNDC.x =  (e.clientX / window.innerWidth)  * 2 - 1;
    mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
  }, { passive: true });
  document.addEventListener('mouseleave', () => { mouseNDC.x = 0; mouseNDC.y = 0; });

  /* ── Scene color lerp ── */
  const sceneColors = {
    s0:  '#29fbff', s2:  '#00ffe0', s3:  '#a78bfa', s4:  '#f472b6',
    s5:  '#34d399', s6:  '#fb923c', s7:  '#00ffe0', s8:  '#00ffe0',
    s9:  '#29fbff', s10: '#fb923c',
  };
  const targetColor  = new THREE.Color(0x29fbff);
  const currentColor = new THREE.Color(0x29fbff);

  Object.entries(sceneColors).forEach(([id, hex]) => {
    const el = document.getElementById(id);
    if (!el) return;
    new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) targetColor.set(hex);
    }, { threshold: 0.3 }).observe(el);
  });

  /* ── Clock + render loop ── */
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    if (document.hidden) return;

    const time = clock.getElapsedTime();
    vp = getViewport();

    /* Color lerp */
    currentColor.lerp(targetColor, 0.03);
    material.color.copy(currentColor);

    /* Scroll → warp intensity (0 = idle, 1 = max warp) */
    scrollSpeed *= 0.92;
    const warp = Math.min(scrollSpeed / 60, 1);

    /* Mouse */
    const md = Math.sqrt(
      (mouseNDC.x - lastMousePos.x) ** 2 +
      (mouseNDC.y - lastMousePos.y) ** 2
    );
    if (md > 0.001) {
      lastMouseMove  = Date.now();
      lastMousePos.x = mouseNDC.x;
      lastMousePos.y = mouseNDC.y;
    }

    let destX = (mouseNDC.x * vp.width)  / 2;
    let destY = (mouseNDC.y * vp.height) / 2;

    if (CFG.autoAnimate && Date.now() - lastMouseMove > 2000) {
      destX = Math.sin(time * 0.5)     * (vp.width  / 4);
      destY = Math.cos(time * 0.5 * 2) * (vp.height / 4);
    }

    virtualMouse.x += (destX - virtualMouse.x) * 0.05;
    virtualMouse.y += (destY - virtualMouse.y) * 0.05;
    const tX = virtualMouse.x;
    const tY = virtualMouse.y;

    const globalRot = time * CFG.rotationSpeed;

    /* ── Update each particle ── */
    const activeLerp = CFG.lerpSpeed + warp * 0.12;

    for (let i = 0; i < CFG.count; i++) {
      const p = particles[i];
      p.t += p.speed / 2;

      const projF = 1 - p.cz / 50;
      const projX = tX * projF;
      const projY = tY * projF;

      const dx   = p.mx - projX;
      const dy   = p.my - projY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let posX = p.mx, posY = p.my, posZ = p.mz * CFG.depthFactor;

      /* IDLE: magnetic ring */
      if (dist < CFG.magnetRadius && warp < 0.5) {
        const angle     = Math.atan2(dy, dx) + globalRot;
        const wave      = Math.sin(p.t * CFG.waveSpeed + angle) * (0.5 * CFG.waveAmplitude);
        const deviation = p.randomRadiusOffset * (5 / (CFG.fieldStrength + 0.1));
        const ringR     = CFG.ringRadius + wave + deviation;
        posX = projX + ringR * Math.cos(angle);
        posY = projY + ringR * Math.sin(angle);
        posZ = p.mz * CFG.depthFactor + Math.sin(p.t) * CFG.waveAmplitude * CFG.depthFactor;
      }

      /* SCROLL-BLAST: push Z toward camera + radial spread */
      if (warp > 0.01) {
        const radX = p.mx / (vp.width * 0.5);
        const radY = p.my / (vp.height * 0.5);
        posZ += warp * 25;
        posX += radX * warp * 4;
        posY += radY * warp * 4;
      }

      /* Lerp to target */
      p.cx += (posX - p.cx) * activeLerp;
      p.cy += (posY - p.cy) * activeLerp;
      p.cz += (posZ - p.cz) * activeLerp;

      /* Respawn if particle flew past camera */
      if (p.cz > 40) {
        p.mx = (Math.random() - 0.5) * vp.width;
        p.my = (Math.random() - 0.5) * vp.height;
        p.mz = -12 - Math.random() * 20;
        p.cx = p.mx; p.cy = p.my; p.cz = p.mz;
      }

      /* Orientation */
      dummy.position.set(p.cx, p.cy, p.cz);
      dummy.lookAt(projX, projY, p.cz);
      dummy.rotateX(Math.PI / 2);

      /* Scale: ring proximity + pulse + warp depth stretch */
      const cDist      = Math.sqrt((p.cx - projX) ** 2 + (p.cy - projY) ** 2);
      const distRing   = Math.abs(cDist - CFG.ringRadius);
      const scaleFac   = Math.max(0, Math.min(1, 1 - distRing / 10));
      const baseScale  = scaleFac
        * (0.8 + Math.sin(p.t * CFG.pulseSpeed) * 0.2 * CFG.particleVariance)
        * CFG.particleSize;

      /* Warp makes particles bigger + stretched (streak lines) */
      const warpDepth   = Math.max(0, (p.cz + 10) / 30);
      const warpGrow    = 1 + warpDepth * warp * 3;
      const warpStretch = 1 + warp * 6;   // elongate capsule → streak
      const sx = baseScale * warpGrow;
      const sy = baseScale * warpGrow * warpStretch;
      const sz = baseScale * warpGrow;

      dummy.scale.set(
        Math.max(0.001, sx),
        Math.max(0.001, sy),
        Math.max(0.001, sz)
      );

      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
  }

  animate();

  /* ── Resize ── */
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }, { passive: true });
})();

/* ─────────────────────────────────────────────────────
   2. HERO FLOATING PARTICLES + EXPANDING CIRCLES
   Particles spawn with negative delay so they're
   already mid-flight on page load.
───────────────────────────────────────────────────── */
(function initHeroEffects() {
  // Floating dots
  const pc = document.getElementById('heroParticles');
  if (pc) {
    for (let i = 0; i < 42; i++) {
      const p    = document.createElement('div');
      p.className = 'h-particle';
      const size  = 1 + Math.random() * 2.5;
      const dur   = 5 + Math.random() * 9;
      const delay = -Math.random() * dur;  // negative = already running
      const color = Math.random() > 0.85
        ? 'rgba(0,119,255,0.8)'
        : 'rgba(0,255,224,0.7)';
      p.style.cssText = `left:${Math.random()*100}%;width:${size}px;height:${size}px;animation-duration:${dur}s;animation-delay:${delay}s;background:${color};`;
      pc.appendChild(p);
    }
  }

  // Expanding orbit rings
  const cc = document.getElementById('heroCircles');
  if (cc) {
    [300, 500, 700, 900].forEach((size, i) => {
      const c     = document.createElement('div');
      c.className = 'h-circle';
      c.style.cssText = `width:${size}px;height:${size}px;left:15%;top:50%;animation-duration:${6 + i * 2}s;animation-delay:${i * 1.5}s;`;
      cc.appendChild(c);
    });
  }
})();


/* ─────────────────────────────────────────────────────
   3. PER-CATEGORY BG CANVAS
   Each category scene (s2–s6) shows a unique canvas
   animation that matches its domain:
     s2 Quant   → Monte Carlo stock price paths
     s3 Physics → Orbital electron simulation
     s4 ML/AI   → Neural network signal propagation
     s5 Data    → ETL pipeline flow
     s6 Auto    → Circuit board traces + pulses
   Only one animation renders at a time (intersection
   observer switches activeAnim).
───────────────────────────────────────────────────── */
(function initCategoryCanvas() {
  const canvas = document.getElementById('bgCanvas');
  const ctx    = canvas.getContext('2d');
  let W, H;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', () => { resize(); mlNodes = []; buildPipes(); buildCircuit(); }, { passive: true });

  // Which scene is active
  let activeAnim = null;
  const catIds   = ['s2', 's3', 's4', 's5', 's6'];

  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        activeAnim           = e.target.id;
        canvas.style.opacity = '1';
      } else {
        const anyVisible = catIds.some(id => {
          const el = document.getElementById(id);
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.top < window.innerHeight && r.bottom > 0;
        });
        if (!anyVisible) {
          canvas.style.opacity = '0';
          activeAnim           = null;
        }
      }
    });
  }, { threshold: 0.2 });

  catIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  });

  /* ── QUANT: Monte Carlo stock paths ── */
  let qPaths = [];
  function qNewPath() {
    const steps = 120;
    const pts   = [{ x: W * 0.05, y: H * 0.5 }];
    let price   = 100;
    for (let i = 1; i < steps; i++) {
      price *= Math.exp((0.05 / 252) + (0.2 / Math.sqrt(252)) * (Math.random() * 2 - 1) * 1.5);
      pts.push({ x: W * 0.05 + (i / steps) * W * 0.9, y: H * 0.5 - (price - 100) * (H * 0.003) });
    }
    return { pts, progress: Math.random() * 40, speed: 0.3 + Math.random() * 0.5, alpha: 0.1 + Math.random() * 0.2, width: 0.5 + Math.random() };
  }
  for (let i = 0; i < 20; i++) qPaths.push(qNewPath());

  function drawQuant() {
    ctx.clearRect(0, 0, W, H);
    // Grid
    ctx.strokeStyle = 'rgba(0,255,224,0.04)'; ctx.lineWidth = 1;
    for (let y = 0; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    for (let x = 0; x < W; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    // Baseline
    ctx.strokeStyle = 'rgba(0,255,224,0.2)'; ctx.setLineDash([4, 8]);
    ctx.beginPath(); ctx.moveTo(W * 0.05, H * 0.5); ctx.lineTo(W * 0.95, H * 0.5); ctx.stroke();
    ctx.setLineDash([]);
    // Paths
    qPaths.forEach(p => {
      p.progress = Math.min(p.progress + p.speed, p.pts.length - 1);
      const end  = Math.floor(p.progress);
      if (end < 2) return;
      ctx.beginPath(); ctx.moveTo(p.pts[0].x, p.pts[0].y);
      for (let i = 1; i <= end; i++) ctx.lineTo(p.pts[i].x, p.pts[i].y);
      ctx.strokeStyle = `rgba(0,255,224,${p.alpha})`; ctx.lineWidth = p.width; ctx.stroke();
      if (p.progress >= p.pts.length - 1) { p.progress = 0; Object.assign(p, qNewPath()); }
    });
    // Origin glow
    const og = ctx.createRadialGradient(W * 0.05, H * 0.5, 0, W * 0.05, H * 0.5, 50);
    og.addColorStop(0, 'rgba(0,255,224,0.4)'); og.addColorStop(1, 'rgba(0,255,224,0)');
    ctx.fillStyle = og; ctx.fillRect(0, 0, W, H);
  }

  /* ── PHYSICS: Orbital electrons ── */
  let phT   = 0;
  const orbs = [
    { rx: 0.18, ry: 0.12, tilt: 0,   speed: 0.008, e: 2, ph: 0   },
    { rx: 0.27, ry: 0.18, tilt: 1.1, speed: 0.005, e: 3, ph: 1   },
    { rx: 0.36, ry: 0.24, tilt: 2.2, speed: 0.003, e: 4, ph: 2   },
    { rx: 0.45, ry: 0.30, tilt: 0.6, speed: 0.006, e: 2, ph: 1.5 },
  ];

  function drawPhysics() {
    ctx.clearRect(0, 0, W, H); phT += 0.5;
    const cx = W * 0.5, cy = H * 0.5;
    // Nucleus glow
    const ng = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60);
    ng.addColorStop(0, 'rgba(167,139,250,0.4)'); ng.addColorStop(1, 'rgba(167,139,250,0)');
    ctx.fillStyle = ng; ctx.fillRect(0, 0, W, H);
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fillStyle = 'rgba(167,139,250,1)'; ctx.fill();

    orbs.forEach(o => {
      const rx = o.rx * Math.min(W, H);
      const ry = o.ry * Math.min(W, H);
      const tn = o.tilt + phT * 0.008;
      // Orbit ring
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(tn);
      ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(167,139,250,0.2)'; ctx.lineWidth = 0.8; ctx.stroke(); ctx.restore();
      // Electrons
      for (let i = 0; i < o.e; i++) {
        const ang = (phT * o.speed * 60) + o.ph + (i / o.e) * Math.PI * 2;
        const ex  = rx * Math.cos(ang), ey = ry * Math.sin(ang);
        const ex2 = ex * Math.cos(tn) - ey * Math.sin(tn);
        const ey2 = ex * Math.sin(tn) + ey * Math.cos(tn);
        const eg  = ctx.createRadialGradient(cx + ex2, cy + ey2, 0, cx + ex2, cy + ey2, 12);
        eg.addColorStop(0, 'rgba(167,139,250,0.9)'); eg.addColorStop(1, 'rgba(167,139,250,0)');
        ctx.fillStyle = eg; ctx.fillRect(cx + ex2 - 12, cy + ey2 - 12, 24, 24);
        ctx.beginPath(); ctx.arc(cx + ex2, cy + ey2, 3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(167,139,250,1)'; ctx.fill();
      }
    });
  }

  /* ── ML: Neural network signal propagation ── */
  let mlT = 0, mlNodes = [], mlSig = [];
  const mlL = [3, 5, 5, 4, 2];

  function buildML() {
    mlNodes = [];
    const lx = W * 0.1, tw = W * 0.8;
    mlL.forEach((cnt, li) => {
      for (let ni = 0; ni < cnt; ni++) {
        mlNodes.push({ x: lx + (li / (mlL.length - 1)) * tw, y: H * 0.15 + ((ni + 0.5) / cnt) * H * 0.7, layer: li, pulse: Math.random() * Math.PI * 2 });
      }
    });
  }

  function mlSpawn() {
    const src = mlNodes.filter(n => n.layer === 0);
    const s   = src[Math.floor(Math.random() * src.length)];
    const nxt = mlNodes.filter(n => n.layer === 1);
    const d   = nxt[Math.floor(Math.random() * nxt.length)];
    mlSig.push({ sx: s.x, sy: s.y, dx: d.x, dy: d.y, p: 0, sp: 0.015, layer: 0 });
  }

  function drawML() {
    ctx.clearRect(0, 0, W, H); mlT++;
    if (!mlNodes.length) buildML();
    // Connections
    for (let li = 0; li < mlL.length - 1; li++) {
      const fr = mlNodes.filter(n => n.layer === li);
      const to = mlNodes.filter(n => n.layer === li + 1);
      fr.forEach(f => to.forEach(t => { ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(t.x, t.y); ctx.strokeStyle = 'rgba(244,114,182,0.07)'; ctx.lineWidth = 0.8; ctx.stroke(); }));
    }
    // Signals
    mlSig = mlSig.filter(sig => {
      sig.p += sig.sp;
      const px = sig.sx + (sig.dx - sig.sx) * sig.p;
      const py = sig.sy + (sig.dy - sig.sy) * sig.p;
      const sg = ctx.createRadialGradient(px, py, 0, px, py, 8);
      sg.addColorStop(0, 'rgba(244,114,182,0.9)'); sg.addColorStop(1, 'rgba(244,114,182,0)');
      ctx.fillStyle = sg; ctx.fillRect(px - 8, py - 8, 16, 16);
      if (sig.p >= 1 && sig.layer < mlL.length - 2) {
        const nxt = mlNodes.filter(n => n.layer === sig.layer + 2);
        if (nxt.length) {
          const d = nxt[Math.floor(Math.random() * nxt.length)];
          mlSig.push({ sx: sig.dx, sy: sig.dy, dx: d.x, dy: d.y, p: 0, sp: sig.sp, layer: sig.layer + 1 });
        }
        return false;
      }
      return sig.p < 1;
    });
    if (mlT % 18 === 0) mlSpawn();
    // Nodes
    mlNodes.forEach(n => {
      n.pulse += 0.04;
      const a  = 0.5 + 0.3 * Math.sin(n.pulse);
      const ng = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 14);
      ng.addColorStop(0, `rgba(244,114,182,${a})`); ng.addColorStop(1, 'rgba(244,114,182,0)');
      ctx.fillStyle = ng; ctx.fillRect(n.x - 14, n.y - 14, 28, 28);
      ctx.beginPath(); ctx.arc(n.x, n.y, 3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(244,114,182,0.9)'; ctx.fill();
    });
  }

  /* ── DATA: ETL pipeline ── */
  let dtT = 0, dtPipes = [];
  const dtNodes = [{ x: 0.15, label: 'SOURCE' }, { x: 0.5, label: 'TRANSFORM' }, { x: 0.85, label: 'SINK' }];

  function buildPipes() {
    dtPipes = [];
    for (let i = 0; i < 10; i++) {
      dtPipes.push({ y: H * 0.08 + (i / 9) * H * 0.84, speed: 0.6 + Math.random() * 1.6, alpha: 0.05 + Math.random() * 0.12, len: 12 + Math.random() * 20, gap: 18 + Math.random() * 40 });
    }
  }

  function drawData() {
    ctx.clearRect(0, 0, W, H); dtT++;
    if (!dtPipes.length) buildPipes();
    // Flow lines
    dtPipes.forEach(p => {
      ctx.strokeStyle   = `rgba(52,211,153,${p.alpha})`; ctx.lineWidth = 1;
      ctx.setLineDash([p.len, p.gap]); ctx.lineDashOffset = -(dtT * p.speed) % (p.len + p.gap);
      ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(W, p.y); ctx.stroke();
    });
    ctx.setLineDash([]);
    // Node boxes
    dtNodes.forEach((nd, i) => {
      const nx = W * nd.x, ny = H * 0.5, bw = 90, bh = 46;
      ctx.fillStyle = 'rgba(8,11,15,0.85)'; ctx.fillRect(nx - bw/2, ny - bh/2, bw, bh);
      ctx.strokeStyle = 'rgba(52,211,153,0.55)'; ctx.lineWidth = 1; ctx.strokeRect(nx - bw/2, ny - bh/2, bw, bh);
      ctx.font = "bold 7px 'Space Mono', monospace"; ctx.fillStyle = 'rgba(52,211,153,0.9)'; ctx.textAlign = 'center'; ctx.fillText(nd.label, nx, ny - 3);
      const pulse = (dtT * 0.03 + i) % 1;
      ctx.beginPath(); ctx.arc(nx, ny, 36 + pulse * 22, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(52,211,153,${0.12 * (1 - pulse)})`; ctx.lineWidth = 1; ctx.stroke();
    });
    // Moving packets
    for (let i = 0; i < 6; i++) {
      const prog = ((dtT * 0.005) + i / 6) % 1;
      const px   = W * 0.15 + prog * W * 0.7, py = H * 0.5;
      const pg   = ctx.createRadialGradient(px, py, 0, px, py, 10);
      pg.addColorStop(0, 'rgba(52,211,153,0.9)'); pg.addColorStop(1, 'rgba(52,211,153,0)');
      ctx.fillStyle = pg; ctx.fillRect(px - 10, py - 10, 20, 20);
      ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(52,211,153,1)'; ctx.fill();
    }
  }

  /* ── AUTO: Circuit board traces ── */
  let auT = 0, auSegs = [], auPulses = [];
  const GRID = 55;

  function buildCircuit() {
    auSegs = []; auPulses = [];
    const cols = Math.ceil(W / GRID), rows = Math.ceil(H / GRID);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (Math.random() < 0.28) {
          const horiz = Math.random() > 0.5;
          auSegs.push({ x: c * GRID, y: r * GRID, horiz, len: GRID * (1 + Math.floor(Math.random() * 3)), alpha: 0.05 + Math.random() * 0.09, dot: Math.random() > 0.6 });
        }
      }
    }
  }

  function drawAuto() {
    ctx.clearRect(0, 0, W, H); auT++;
    if (!auSegs.length) buildCircuit();
    // Traces
    auSegs.forEach(s => {
      ctx.strokeStyle = `rgba(251,146,60,${s.alpha})`; ctx.lineWidth = 1; ctx.beginPath();
      if (s.horiz) { ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + s.len, s.y); }
      else         { ctx.moveTo(s.x, s.y); ctx.lineTo(s.x, s.y + s.len); }
      ctx.stroke();
      if (s.dot) { ctx.beginPath(); ctx.arc(s.x, s.y, 2, 0, Math.PI * 2); ctx.fillStyle = `rgba(251,146,60,${s.alpha * 2})`; ctx.fill(); }
    });
    // Spawn new pulses
    if (auT % 7 === 0 && auPulses.length < 35) {
      const seg = auSegs[Math.floor(Math.random() * auSegs.length)];
      if (seg) auPulses.push({ seg, p: 0, sp: 0.012 + Math.random() * 0.02 });
    }
    // Draw + advance pulses
    auPulses = auPulses.filter(pu => {
      pu.p += pu.sp;
      const s  = pu.seg;
      const px = s.horiz ? s.x + pu.p * s.len : s.x;
      const py = s.horiz ? s.y : s.y + pu.p * s.len;
      const pg = ctx.createRadialGradient(px, py, 0, px, py, 10);
      pg.addColorStop(0, 'rgba(251,146,60,0.85)'); pg.addColorStop(1, 'rgba(251,146,60,0)');
      ctx.fillStyle = pg; ctx.fillRect(px - 10, py - 10, 20, 20);
      ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(251,146,60,1)'; ctx.fill();
      return pu.p < 1;
    });
  }

  /* ── Main render loop — only draws active scene ── */
  (function loop() {
    switch (activeAnim) {
      case 's2': drawQuant();   break;
      case 's3': drawPhysics(); break;
      case 's4': drawML();      break;
      case 's5': drawData();    break;
      case 's6': drawAuto();    break;
      default:   ctx.clearRect(0, 0, W, H);
    }
    requestAnimationFrame(loop);
  })();
})();
