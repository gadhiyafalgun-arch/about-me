'use strict';

/**
 * AOS Custom — Animate On Scroll
 * Pure vanilla JS. No external dependencies.
 * Fixed version: corrects .tag → .skill-tag selector, adds parallax RAF loop,
 * fixes stagger-children timing, adds draw-line SVG support.
 */
const AOS = (() => {

  /* ── Config defaults ── */
  const config = {
    threshold: 0.12,
    rootMargin: '0px 0px -60px 0px',
    once: true,
    disableOnMobile: false,
  };

  let observer = null;
  let parallaxEls = [];
  let rafId = null;
  let lastScrollY = window.scrollY;

  /* ═══════════════════════════════════
     INIT
  ═══════════════════════════════════ */
  const init = (options = {}) => {
    Object.assign(config, options);

    if (config.disableOnMobile && window.innerWidth < 768) return;

    observer = new IntersectionObserver(handleIntersect, {
      threshold: config.threshold,
      rootMargin: config.rootMargin,
    });

    scanElements();
    startParallaxLoop();

    window.addEventListener('resize', debounce(() => {
      observer.disconnect();
      parallaxEls = [];
      scanElements();
    }, 150));
  };

  /* ═══════════════════════════════════
     SCAN DOM
  ═══════════════════════════════════ */
  const scanElements = () => {
    const els = Array.from(document.querySelectorAll('[data-aos]'));

    els.forEach(el => {
      const type     = el.getAttribute('data-aos');
      const delay    = el.getAttribute('data-aos-delay');
      const duration = el.getAttribute('data-aos-duration');

      /* Apply inline timing overrides */
      if (delay)    el.style.transitionDelay    = `${parseInt(delay) / 1000}s`;
      if (duration) el.style.transitionDuration = `${parseInt(duration) / 1000}s`;

      /* Parallax elements — observe but also track for RAF */
      if (type === 'parallax') {
        parallaxEls.push(el);
      }

      /* Store original type for reset */
      if (!el.dataset.aosOriginal) el.dataset.aosOriginal = type;

      observer.observe(el);
    });
  };

  /* ═══════════════════════════════════
     INTERSECTION HANDLER
  ═══════════════════════════════════ */
  const handleIntersect = (entries) => {
    entries.forEach(entry => {
      const el = entry.target;
      const once = el.getAttribute('data-aos-once') !== 'false' && config.once;

      if (entry.isIntersecting) {
        el.classList.add('aos-vis');
        triggerSpecialEffects(el);
        if (once) observer.unobserve(el);
      } else if (!once) {
        el.classList.remove('aos-vis');
      }
    });
  };

  /* ═══════════════════════════════════
     SPECIAL EFFECTS DISPATCHER
  ═══════════════════════════════════ */
  const triggerSpecialEffects = (el) => {
    const type = el.getAttribute('data-aos');
    switch (type) {
      case 'number-count':    handleNumberCount(el);    break;
      case 'text-scramble':   handleTextScramble(el);   break;
      case 'stagger-children': handleStaggerChildren(el); break;
      case 'draw-line':       handleDrawLine(el);       break;
    }
  };

  /* ── Number Counter ── */
  const handleNumberCount = (el) => {
    const raw = el.getAttribute('data-aos-target') || el.textContent.trim();
    const final = parseFloat(raw);
    if (isNaN(final)) return;

    const duration  = parseInt(el.getAttribute('data-aos-duration')) || 1800;
    const decimals  = (final.toString().split('.')[1] || '').length;
    const startTime = performance.now();

    /* Overwrite display with 0 to start */
    el.textContent = (0).toFixed(decimals);

    const tick = (now) => {
      const elapsed  = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      /* Ease-out cubic */
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = (final * eased).toFixed(decimals);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  /* ── Text Scramble ── */
  const handleTextScramble = (el) => {
    const target = el.textContent.trim();
    const chars  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let iteration = 0;

    const scramble = () => {
      let out = '';
      for (let i = 0; i < target.length; i++) {
        if (i < iteration) {
          out += target[i];
        } else {
          /* Keep spaces and punctuation as-is */
          out += target[i] === ' ' ? ' ' : chars[Math.floor(Math.random() * chars.length)];
        }
      }
      el.textContent = out;
      if (iteration <= target.length) {
        setTimeout(scramble, 38);
        iteration++;
      } else {
        el.textContent = target;
      }
    };
    scramble();
  };

  /* ── Stagger Children ── */
  const handleStaggerChildren = (el) => {
    const children = Array.from(el.children);
    const stagger  = parseInt(el.getAttribute('data-aos-stagger')) || 100;

    children.forEach((child, i) => {
      child.style.transitionDelay = `${i * stagger}ms`;
      /* Small rAF delay so CSS transition actually fires */
      requestAnimationFrame(() => requestAnimationFrame(() => {
        child.classList.add('aos-vis');
        child.style.opacity = '1';
        child.style.transform = 'translateY(0)';
      }));
    });
  };

  /* ── Draw SVG Line ── */
  const handleDrawLine = (el) => {
    const targets = el.matches('path, line, circle, rect, polygon')
      ? [el]
      : Array.from(el.querySelectorAll('path, line, circle, rect, polygon'));

    targets.forEach(path => {
      if (typeof path.getTotalLength === 'function') {
        const len = path.getTotalLength();
        path.style.strokeDasharray  = len;
        path.style.strokeDashoffset = len;
        /* Next frame to trigger the CSS transition */
        requestAnimationFrame(() => {
          path.style.strokeDashoffset = '0';
        });
      }
    });
  };

  /* ═══════════════════════════════════
     PARALLAX RAF LOOP
  ═══════════════════════════════════ */
  const startParallaxLoop = () => {
    const loop = () => {
      const scrollY = window.scrollY;
      if (scrollY !== lastScrollY) {
        lastScrollY = scrollY;
        parallaxEls.forEach(el => {
          const speed = parseFloat(el.getAttribute('data-aos-parallax-speed')) || 0.3;
          const dir   = el.getAttribute('data-aos-parallax-dir') === 'down' ? 1 : -1;
          const rect  = el.getBoundingClientRect();
          const mid   = rect.top + rect.height / 2;
          const offset = (mid - window.innerHeight / 2) * speed * dir;
          el.style.transform = `translateY(${offset}px)`;
        });
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  };

  /* ═══════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════ */
  const refresh = () => {
    if (observer) observer.disconnect();
    parallaxEls = [];
    scanElements();
  };

  const reset = (el) => {
    el.classList.remove('aos-vis');
    el.style.transitionDelay    = '';
    el.style.transitionDuration = '';
  };

  /* ── Utility: debounce ── */
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  return { init, refresh, reset };
})();

/* Auto-init */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => AOS.init());
} else {
  AOS.init();
}

window.AOS = AOS;
