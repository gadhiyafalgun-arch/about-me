/* ═══════════════════════════════════════════════════════
   scroll-animation.js  —  Everything scroll-driven
     1. Lenis smooth scroll (driven from the GSAP ticker)
     2. Scene engine — scrubbed panel crossfade + triggered content reveals
     3. Skill bar animation
     4. Marquee populate
     5. Scroll progress bar + active nav highlight
   ═══════════════════════════════════════════════════════ */

/* Bail out if the libraries are missing (blocked request, offline, CDN outage). Leaving
   html.scene-engine unset keeps .scene-content visible so the page degrades to a plain
   scrolling document instead of rendering blank. */
if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') {
  console.warn('[scroll] GSAP unavailable — scene engine disabled, content shown unanimated.');
} else {
document.documentElement.classList.add('scene-engine');
gsap.registerPlugin(ScrollTrigger);

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const TOUCH   = window.matchMedia('(pointer: coarse)').matches;

/* Scene ids in document order. s1 was removed from the HTML. */
const SCENE_IDS = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/* ─────────────────────────────────────────────────────
   1. LENIS SMOOTH SCROLL

   Native scroll + a scrubbed timeline always lags a little behind the wheel. Lenis interpolates
   the scroll position itself, which is what gives the reference sites their weight.

   Off for touch (native momentum is better than anything we'd synthesise) and off for reduced
   motion. Driven from gsap.ticker so it shares the one rAF loop rather than opening another.
───────────────────────────────────────────────────── */
let lenis = null;
if (!REDUCED && !TOUCH && typeof Lenis !== 'undefined') {
  lenis = new Lenis({
    duration: 1.05,
    easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)),   // expo.out
    smoothWheel: true,
    wheelMultiplier: 0.9,
  });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add(time => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  window.__lenis = lenis;

  // Route in-page anchors through Lenis so nav clicks glide instead of jumping.
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const target = document.querySelector(a.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: 0, duration: 1.5 });
    });
  });
}

/* ─────────────────────────────────────────────────────
   2. SCENE ENGINE

   Each scene owns 3 viewport-heights of scroll travel. Within that range:

     IN   (0.00 → 0.30)  panel fades up into place
     HOLD (0.30 → 0.62)  panel drifts a few px — enough to stay alive, not enough to distract
     OUT  (0.62 → 1.00)  panel lifts away and fades

   The panel crossfade is scrubbed because it genuinely is a function of scroll position. The
   content *inside* the panel is revealed by a played timeline (see reveal.js) so its easing
   survives regardless of how fast the user scrolls.

   Exits deliberately move the panel only, never its children: mini-fx.js writes inline
   transforms on hover for tiles and buttons, and two systems animating the same `transform`
   would clobber each other.
───────────────────────────────────────────────────── */
const P_IN   = 0.30;
const P_HOLD = 0.32;
const P_OUT  = 0.38;

let VH           = window.innerHeight;
let SCENE_SCROLL = VH * 3;

function buildScenes() {
  SCENE_IDS.forEach((i, idx) => {
    const se = document.getElementById('s' + i);
    const ce = document.getElementById('c' + i);
    if (!se || !ce) return;

    se.style.height = SCENE_SCROLL + 'px';
    se.style.zIndex = idx + 1;
    const sticky = se.querySelector('.scene-sticky');
    if (sticky) sticky.style.zIndex = idx + 1;

    if (REDUCED) {                       // no scrubbing, no transforms — just show it
      gsap.set(ce, { opacity: 1, y: 0 });
      window.Reveal?.revealScene(ce, true);
      return;
    }

    window.Reveal?.armScene(ce);

    const tl = gsap.timeline({ paused: true });
    tl.fromTo(ce,
        { opacity: 0, y: 30 },
        { opacity: 1, y: 0, ease: 'power2.out', duration: P_IN }, 0)
      .to(ce, { y: -14, ease: 'none', duration: P_HOLD }, P_IN)
      .to(ce, { opacity: 0, y: -80, ease: 'power2.in', duration: P_OUT }, P_IN + P_HOLD);

    ScrollTrigger.create({
      trigger: se,
      start: 'top top',
      end: `+=${SCENE_SCROLL}`,
      scrub: 1,
      animation: tl,
      invalidateOnRefresh: true,
    });

    // Content reveal: plays once, when the scene is most of the way into view.
    // The hero is excluded — it already sits past this trigger point at scroll 0, so the trigger
    // would fire on creation and pre-empt the boot-gated reveal below.
    if (i !== 0) {
      ScrollTrigger.create({
        trigger: se,
        start: 'top 55%',
        once: true,
        onEnter: () => window.Reveal?.revealScene(ce),
      });
    }
  });
}
buildScenes();

/* Recompute on resize. Mobile browsers fire resize every time the URL bar slides, which would
   otherwise re-lay-out all ten scenes mid-scroll — so height-only changes under 20% are ignored. */
let lastW = window.innerWidth, lastH = window.innerHeight, resizeTimer;
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  const widthChanged = w !== lastW;
  const bigHeightChange = Math.abs(h - lastH) / lastH > 0.2;
  if (!widthChanged && !bigHeightChange) return;
  lastW = w; lastH = h;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    VH = window.innerHeight;
    SCENE_SCROLL = VH * 3;
    SCENE_IDS.forEach(i => {
      const se = document.getElementById('s' + i);
      if (se) se.style.height = SCENE_SCROLL + 'px';
    });
    ScrollTrigger.refresh();
  }, 180);
}, { passive: true });

/* Nav fades in once. */
gsap.to('#nav', { opacity: 1, duration: 1.2, ease: 'power2.out', delay: 0.25 });

/* Hero reveals on load rather than on a scroll trigger — but only once the boot overlay has
   wiped away, otherwise the entrance plays out behind it and is never seen. The timeout is a
   fallback in case mini-fx.js is unavailable and the event never fires. */
const heroContent = document.getElementById('c0');
if (heroContent && !REDUCED) {
  let heroStarted = false;
  const startHero = () => {
    if (heroStarted) return;
    heroStarted = true;
    gsap.set(heroContent, { opacity: 1, y: 0 });
    window.Reveal?.revealScene(heroContent);
    ScrollTrigger.refresh();
  };
  document.addEventListener('boot:done', startHero, { once: true });
  setTimeout(startHero, 1400);
}


/* ─────────────────────────────────────────────────────
   3. SKILL BAR ANIMATION
   Bars start at width:0 (CSS), animate to data-w % once Skills scrolls into view.
───────────────────────────────────────────────────── */
new IntersectionObserver(entries => {
  if (!entries[0].isIntersecting) return;
  document.querySelectorAll('.skill-bar-fill').forEach(bar => {
    setTimeout(() => { bar.style.width = bar.dataset.w + '%'; }, 200);
  });
}, { threshold: 0.2 }).observe(document.getElementById('s7'));


/* ─────────────────────────────────────────────────────
   4. MARQUEE — populate both halves so the CSS loop is seamless
───────────────────────────────────────────────────── */
const marqueeSkills = [
  'Python', 'NumPy', 'Pandas', 'Monte Carlo', 'Quantum Mechanics',
  'Statistics', 'Data Analysis', 'Git', 'Automation',
  'Black-Scholes', 'Physics', 'AI Tools', 'Research', 'SciPy',
];
const track = document.getElementById('marqueeTrack');
if (track) {
  [...marqueeSkills, ...marqueeSkills].forEach(skill => {
    const el       = document.createElement('span');
    el.className   = 'marquee-item';
    el.textContent = skill;
    track.appendChild(el);
  });
}


/* ─────────────────────────────────────────────────────
   5. SCROLL PROGRESS BAR + ACTIVE NAV
───────────────────────────────────────────────────── */
const progressBar = document.getElementById('scroll-progress');
const navLinks    = document.querySelectorAll('.nav-links a');

const sceneNav = [
  { id: 's2',  href: '#s2',  color: '#00ffe0' },  // quant
  { id: 's3',  href: '#s3',  color: '#a78bfa' },  // physics
  { id: 's4',  href: '#s4',  color: '#f472b6' },  // ml
  { id: 's5',  href: '#s5',  color: '#34d399' },  // data
  { id: 's6',  href: '#s6',  color: '#fb923c' },  // auto
  { id: 's7',  href: '#s7',  color: '#00ffe0' },  // skills
  { id: 's8',  href: '#s8',  color: '#00ffe0' },  // experience
  { id: 's9',  href: '#s9',  color: '#fb923c' },  // about
  { id: 's10', href: '#s10', color: '#fb923c' },  // contact
];

/* Runs off ScrollTrigger rather than its own scroll listener, so it shares the one rAF loop
   and stays in sync with Lenis's interpolated position. */
ScrollTrigger.create({
  start: 0,
  end: 'max',
  onUpdate: self => {
    if (progressBar) progressBar.style.width = (self.progress * 100) + '%';

    let activeColor = '#00ffe0';
    let activeHref  = '';
    const mid = window.innerHeight * 0.5;

    sceneNav.forEach(({ id, href, color }) => {
      const el = document.getElementById(id);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.top <= mid && rect.bottom >= mid) { activeColor = color; activeHref = href; }
    });

    if (progressBar) {
      progressBar.style.background = activeColor;
      progressBar.style.boxShadow  = `0 0 8px ${activeColor}`;
    }
    navLinks.forEach(a => {
      const isActive = a.getAttribute('href') === activeHref;
      a.classList.toggle('active', isActive);
      a.style.color = isActive ? activeColor : '';
    });
  },
});

}  /* end GSAP availability guard */
