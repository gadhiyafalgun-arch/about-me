/* ═══════════════════════════════════════════════════════
   js/gl/scene.js — the point field that sits behind the whole page.

   One THREE.Points, one ShaderMaterial, one draw call. Positions are static attributes and all
   motion happens in the vertex shader, so the per-frame CPU cost does not grow with point count.
   (The system this replaces wrote 300 instance matrices per frame on the CPU.)
   ═══════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { VERT, FRAG } from './shaders.js';
import { getFormation, SCENE_FORMATION } from './formations.js';

/* ─────────────────────────────────────────────────────
   Capability tiers
───────────────────────────────────────────────────── */
const TIERS = {
  high: { count: 65000, dpr: 2,   size: 1.7 },
  mid:  { count: 18000, dpr: 1.5, size: 2.1 },
};

function detectTier() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'off';

  // Three has required WebGL2 since r163 — no context means no field.
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2');
  if (!gl) return 'off';
  gl.getExtension('WEBGL_lose_context')?.loseContext();

  const cores  = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  if (cores <= 2 || memory <= 2) return 'off';

  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (coarse || window.innerWidth < 900 || cores <= 4 || memory <= 4) return 'mid';
  return 'high';
}

/* ─────────────────────────────────────────────────────
   Boot
───────────────────────────────────────────────────── */
export function initScene() {
  const canvas = document.getElementById('glCanvas');
  if (!canvas) return null;

  let tierName = detectTier();
  window.__gl = { three: THREE.REVISION, tier: tierName, points: 0, drawCalls: 0 };

  if (tierName === 'off') {
    document.documentElement.classList.add('gl-off');
    console.info('[gl] tier=off — static background');
    return null;
  }

  let tier = TIERS[tierName];

  const renderer = new THREE.WebGLRenderer({
    canvas, alpha: true, antialias: false,       // additive points don't benefit from MSAA
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.dpr));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 1, 400);
  camera.position.set(0, 0, 95);

  const group = new THREE.Group();
  scene.add(group);

  /* ── Geometry ── */
  let count = tier.count;
  const geom = new THREE.BufferGeometry();

  const seeds  = new Float32Array(count);
  const scales = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    seeds[i]  = Math.random();
    // Cubed so most points are small and a few are bright — an even spread looks like static.
    scales[i] = 0.35 + Math.pow(Math.random(), 3) * 2.4;
  }

  const start = getFormation('sphere', count);
  geom.setAttribute('position', new THREE.BufferAttribute(start.slice(), 3));  // bounds only
  geom.setAttribute('aPosA',    new THREE.BufferAttribute(start.slice(), 3));
  geom.setAttribute('aPosB',    new THREE.BufferAttribute(start.slice(), 3));
  geom.setAttribute('aSeed',    new THREE.BufferAttribute(seeds, 1));
  geom.setAttribute('aScale',   new THREE.BufferAttribute(scales, 1));
  // The shader moves points well outside their source positions; without a generous manual
  // bound, frustum culling drops the whole cloud at the edges of a morph.
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 140);

  const uniforms = {
    uTime:       { value: 0 },
    uMorph:      { value: 0 },
    uDispersion: { value: 0 },
    uSize:       { value: tier.size },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uMouse:      { value: new THREE.Vector2(0, 0) },
    uColorA:     { value: new THREE.Color('#00ffe0') },
    uColorB:     { value: new THREE.Color('#0077ff') },
    uColorMix:   { value: 0.5 },
    uOpacity:    { value: 0 },                   // faded in once the first frame is up
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geom, material);
  points.frustumCulled = false;
  group.add(points);

  /* ── Mouse (smoothed on the CPU, read as a uniform) ── */
  const mouseTarget = new THREE.Vector2(0, 0);
  if (!window.matchMedia('(pointer: coarse)').matches) {
    window.addEventListener('mousemove', e => {
      mouseTarget.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -((e.clientY / window.innerHeight) * 2 - 1),
      );
    }, { passive: true });
  }

  /* ── Render loop, on the shared GSAP ticker ── */
  const clock = new THREE.Clock();
  let frameTimes = [], watchdogDone = false, watchdogStart = performance.now();

  function render() {
    if (document.hidden) return;

    const dt = Math.min(clock.getDelta(), 0.05);
    uniforms.uTime.value += dt;

    // Ambient rotation — slow enough to read as drift rather than spin.
    group.rotation.y += dt * 0.035;
    group.rotation.x = Math.sin(uniforms.uTime.value * 0.08) * 0.06;

    // Time-based damping so the follow speed is the same at 30, 60 or 120fps.
    uniforms.uMouse.value.lerp(mouseTarget, 1 - Math.exp(-2.2 * dt));
    if (uniforms.uOpacity.value < 1) uniforms.uOpacity.value = Math.min(1, uniforms.uOpacity.value + dt * 0.8);

    renderer.render(scene, camera);

    if (!watchdogDone) sampleWatchdog();
  }

  /* ── Watchdog ──
     UA sniffing guesses at capability; this measures it. If the first couple of seconds are slow,
     drop a tier rather than leaving a stuttering background on screen. */
  function sampleWatchdog() {
    frameTimes.push(performance.now());
    if (performance.now() - watchdogStart < 2200) return;
    watchdogDone = true;

    const d = [];
    for (let i = 1; i < frameTimes.length; i++) d.push(frameTimes[i] - frameTimes[i - 1]);
    d.sort((a, b) => a - b);
    const median = d[Math.floor(d.length / 2)] || 0;
    frameTimes = [];
    window.__gl.medianFrameMs = +median.toFixed(1);

    if (median > 24 && tierName === 'high') { stepDown('mid'); }
    else if (median > 34 && tierName === 'mid') { stepDown('off'); }
  }

  function stepDown(to) {
    console.info(`[gl] frame budget exceeded — stepping ${tierName} → ${to}`);
    tierName = to;
    window.__gl.tier = to;
    if (to === 'off') { teardown(); return; }
    tier = TIERS[to];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.dpr));
    uniforms.uPixelRatio.value = renderer.getPixelRatio();
    // Draw fewer points rather than rebuilding buffers — instant, and the field just thins out.
    count = tier.count;
    geom.setDrawRange(0, count);
    window.__gl.points = count;
    // Give the reduced setup its own measurement window.
    watchdogDone = false; watchdogStart = performance.now(); frameTimes = [];
  }

  function teardown() {
    gsap.ticker.remove(render);
    geom.dispose(); material.dispose(); renderer.dispose();
    canvas.style.display = 'none';
    document.documentElement.classList.add('gl-off');
    window.__gl.points = 0;
  }

  /* ── Context loss ── */
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    console.warn('[gl] context lost — falling back to static background');
    gsap.ticker.remove(render);
    document.documentElement.classList.add('gl-off');
    window.__gl.tier = 'off';
  });

  /* ── Resize ── */
  let rzTimer;
  window.addEventListener('resize', () => {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(() => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      uniforms.uPixelRatio.value = renderer.getPixelRatio();
    }, 160);
  }, { passive: true });

  gsap.ticker.add(render);

  window.__gl.points = count;
  window.__gl.renderer = renderer;
  window.__gl.uniforms = uniforms;
  console.info(`[gl] tier=${tierName} points=${count} dpr=${renderer.getPixelRatio()}`);

  return { renderer, scene, camera, group, geom, uniforms, material, get count() { return count; },
           get tier() { return tierName; } };
}

export { SCENE_FORMATION, getFormation };
