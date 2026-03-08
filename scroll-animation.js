/* ═══════════════════════════════════════════════════════
   scroll-animation.js  —  Everything scroll-driven
     1. GSAP scene engine   (sticky scenes, transitions)
     2. Skill bar animation (triggers on IntersectionObserver)
     3. Marquee populate
     4. Scroll progress bar + active nav highlight
   ═══════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────
   1. GSAP SCENE ENGINE
   Each scene gets 7× viewport-height of scroll travel.
   That travel maps to a 3-phase timeline:
     IN   (30%) — scale 0.03→1, blur 18px→0
     HOLD (25%) — stays at 1
     OUT  (45%) — unique exit per scene
───────────────────────────────────────────────────── */
gsap.registerPlugin(ScrollTrigger);

const VH           = window.innerHeight;
const SCENE_SCROLL = VH * 7;   // px of scroll per scene
const P_IN         = 0.30;
const P_HOLD       = 0.25;
const P_OUT        = 0.45;

// One unique exit animation per scene index
const exits = [
  /* s0  */ { scale: 5,    opacity: 0, filter: 'blur(32px)', x: 0, y: 0, rotation: 0,    ease: 'expo.in',      transformOrigin: '50% 50%' },
  /* s1  */ { scale: 0.03, opacity: 0, filter: 'blur(18px)', x: 0, y: 0, rotation: 0,    ease: 'power3.in',    transformOrigin: '50% 50%' },
  /* s2  */ { scale: 0.05, opacity: 0, filter: 'blur(20px)', x: 0, y: 0, rotation: 360,  ease: 'power2.inOut', transformOrigin: '50% 50%' },
  /* s3  */ { scale: 3.5,  opacity: 0, filter: 'blur(26px)', x: 0, y: 0, rotation: 0,    ease: 'power3.in',    transformOrigin: '50% 50%' },
  /* s4  */ { scale: 0.04, opacity: 0, filter: 'blur(16px)', x: 0, y: 0, rotation: -420, ease: 'power2.in',    transformOrigin: '50% 50%' },
  /* s5  */ { scale: 6,    opacity: 0, filter: 'blur(36px)', x: 0, y: 0, rotation: 12,   ease: 'expo.in',      transformOrigin: '50% 50%' },
  /* s6  */ { scale: 0.02, opacity: 0, filter: 'blur(22px)', x: 0, y: 0, rotation: 180,  ease: 'power1.inOut', transformOrigin: '50% 50%' },
  /* s7  */ { scale: 4,    opacity: 0, filter: 'blur(30px)', x: 0, y: 0, rotation: -15,  ease: 'power2.in',    transformOrigin: '50% 50%' },
  /* s8  */ { scale: 0.03, opacity: 0, filter: 'blur(20px)', x: 0, y: 0, rotation: 720,  ease: 'power3.in',    transformOrigin: '50% 50%' },
  /* s9  */ { scale: 1.06, opacity: 0, filter: 'blur(8px)',  x: 0, y: 0, rotation: 0,    ease: 'power1.in',    transformOrigin: '50% 50%' },
  /* s10 */ { scale: 0.03, opacity: 0, filter: 'blur(18px)', x: 0, y: 0, rotation: 0,    ease: 'power3.in',    transformOrigin: '50% 50%' },
];

for (let i = 0; i <= 10; i++) {
  if (i === 1) continue;  // s1 removed from HTML

  const se = document.getElementById('s' + i);
  const ce = document.getElementById('c' + i);
  if (!se || !ce) continue;

  // Give each scene the correct scroll height + stacking order
  se.style.height  = SCENE_SCROLL + 'px';
  se.style.zIndex  = i + 1;
  se.querySelector('.scene-sticky').style.zIndex = i + 1;

  const tl = gsap.timeline({ paused: true });

  // IN  — zoom-in from tiny blur
  tl.fromTo(ce,
    { scale: 0.03, opacity: 0, filter: 'blur(18px)', x: 0, y: 0, rotation: 0, transformOrigin: '50% 50%' },
    { scale: 1,    opacity: 1, filter: 'blur(0px)',  x: 0, y: 0, rotation: 0, transformOrigin: '50% 50%', ease: 'power2.out', duration: P_IN },
    0);

  // HOLD — static
  tl.to(ce,
    { scale: 1, opacity: 1, filter: 'blur(0px)', x: 0, y: 0, rotation: 0, ease: 'none', duration: P_HOLD },
    P_IN);

  // OUT — unique exit
  tl.to(ce, { ...exits[i], duration: P_OUT }, P_IN + P_HOLD);

  ScrollTrigger.create({
    trigger:   se,
    start:     'top top',
    end:       `+=${SCENE_SCROLL}`,
    scrub:     2,
    animation: tl,
  });
}

// Fade nav in on load
gsap.to('#nav', { opacity: 1, duration: 1.2, ease: 'power2.out', delay: 0.3 });

// Hero intro — big zoom from nothing, then refresh ScrollTrigger
gsap.fromTo('#c0',
  { scale: 0.03, opacity: 0, filter: 'blur(20px)', x: 0, y: 0, transformOrigin: '50% 50%' },
  { scale: 1,    opacity: 1, filter: 'blur(0px)',  x: 0, y: 0,
    duration: 2.2, ease: 'power3.out', delay: 0.1,
    onComplete: () => ScrollTrigger.refresh() }
);


/* ─────────────────────────────────────────────────────
   2. SKILL BAR ANIMATION
   Bars start at width:0 (CSS), animate to data-w %
   once the skills scene scrolls into view.
───────────────────────────────────────────────────── */
new IntersectionObserver(entries => {
  if (!entries[0].isIntersecting) return;
  document.querySelectorAll('.skill-bar-fill').forEach(bar => {
    setTimeout(() => { bar.style.width = bar.dataset.w + '%'; }, 200);
  });
}, { threshold: 0.2 }).observe(document.getElementById('s7'));


/* ─────────────────────────────────────────────────────
   3. MARQUEE — populate both halves so CSS loop works
───────────────────────────────────────────────────── */
const marqueeSkills = [
  'Python', 'NumPy', 'Pandas', 'Monte Carlo', 'Quantum Mechanics',
  'Statistics', 'Data Analysis', 'Git', 'Automation',
  'Black-Scholes', 'Physics', 'AI Tools', 'Research', 'SciPy',
];
const track = document.getElementById('marqueeTrack');
if (track) {
  // Duplicate so the CSS translateX(-50%) loop is seamless
  [...marqueeSkills, ...marqueeSkills].forEach(skill => {
    const el       = document.createElement('span');
    el.className   = 'marquee-item';
    el.textContent = skill;
    track.appendChild(el);
  });
}


/* ─────────────────────────────────────────────────────
   4. SCROLL PROGRESS BAR + ACTIVE NAV
   Progress bar fills as the user scrolls.
   Bar colour + active nav link changes per scene.
───────────────────────────────────────────────────── */
const progressBar = document.getElementById('scroll-progress');
const navLinks    = document.querySelectorAll('.nav-links a');

// Scene→color map (matches --c-* vars)
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

window.addEventListener('scroll', () => {
  // Fill progress bar
  const pct = (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100;
  if (progressBar) progressBar.style.width = pct + '%';

  // Find which scene owns the viewport centre
  let activeColor = '#00ffe0';
  let activeHref  = '';

  sceneNav.forEach(({ id, href, color }) => {
    const el = document.getElementById(id);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.top <= window.innerHeight * 0.5 && rect.bottom >= window.innerHeight * 0.5) {
      activeColor = color;
      activeHref  = href;
    }
  });

  // Update progress bar colour
  if (progressBar) {
    progressBar.style.background = activeColor;
    progressBar.style.boxShadow  = `0 0 8px ${activeColor}`;
  }

  // Toggle .active class + colour on nav links
  navLinks.forEach(a => {
    const isActive = a.getAttribute('href') === activeHref;
    a.classList.toggle('active', isActive);
    a.style.color = isActive ? activeColor : '';
  });
}, { passive: true });
