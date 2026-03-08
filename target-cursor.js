/* ═══════════════════════════════════════════════════════
   target-cursor.js  —  Target Cursor (ReactBits port)
   - Spinning corner brackets that follow the cursor
   - Snaps to .cursor-target elements on hover
   - Uses GSAP (already loaded)
   ═══════════════════════════════════════════════════════ */

(function initTargetCursor() {
  /* ── Mobile detection ── */
  const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isSmallScreen  = window.innerWidth <= 768;
  const mobileRegex    = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
  const isMobileUA     = mobileRegex.test((navigator.userAgent || navigator.vendor || window.opera).toLowerCase());
  const isMobile       = (hasTouchScreen && isSmallScreen) || isMobileUA;

  if (isMobile || typeof gsap === 'undefined') return;

  /* ── Config ── */
  const TARGET_SELECTOR = '.cursor-target';
  const SPIN_DURATION   = 2;
  const HOVER_DURATION  = 0.2;
  const PARALLAX_ON     = true;
  const BORDER_WIDTH    = 3;
  const CORNER_SIZE     = 12;

  /* ── Create DOM elements ── */
  const wrapper = document.createElement('div');
  wrapper.className = 'target-cursor-wrapper';
  wrapper.innerHTML =
    '<div class="target-cursor-dot"></div>' +
    '<div class="target-cursor-corner corner-tl"></div>' +
    '<div class="target-cursor-corner corner-tr"></div>' +
    '<div class="target-cursor-corner corner-br"></div>' +
    '<div class="target-cursor-corner corner-bl"></div>';
  document.body.appendChild(wrapper);

  const dot     = wrapper.querySelector('.target-cursor-dot');
  const corners = Array.from(wrapper.querySelectorAll('.target-cursor-corner'));

  /* ── State ── */
  let spinTl                  = null;
  let activeTarget            = null;
  let currentLeaveHandler     = null;
  let resumeTimeout           = null;
  let targetCornerPositions   = null;
  let activeStrength          = 0;
  let tickerAdded             = false;

  /* ── Hide default cursor ── */
  document.body.style.cursor = 'none';

  /* ── Initial cursor position ── */
  gsap.set(wrapper, {
    xPercent: -50,
    yPercent: -50,
    x: window.innerWidth  / 2,
    y: window.innerHeight / 2,
  });

  /* ── Move cursor ── */
  function moveCursor(x, y) {
    gsap.to(wrapper, { x, y, duration: 0.1, ease: 'power3.out' });
  }

  /* ── Spin timeline ── */
  function createSpinTimeline() {
    if (spinTl) spinTl.kill();
    spinTl = gsap.timeline({ repeat: -1 })
      .to(wrapper, { rotation: '+=360', duration: SPIN_DURATION, ease: 'none' });
  }
  createSpinTimeline();

  /* ── GSAP ticker: parallax corners toward target ── */
  function tickerFn() {
    if (!targetCornerPositions || activeStrength === 0) return;

    const cursorX = gsap.getProperty(wrapper, 'x');
    const cursorY = gsap.getProperty(wrapper, 'y');

    corners.forEach((corner, i) => {
      const currentX = gsap.getProperty(corner, 'x');
      const currentY = gsap.getProperty(corner, 'y');

      const targetX = targetCornerPositions[i].x - cursorX;
      const targetY = targetCornerPositions[i].y - cursorY;

      const finalX = currentX + (targetX - currentX) * activeStrength;
      const finalY = currentY + (targetY - currentY) * activeStrength;

      const duration = activeStrength >= 0.99 ? (PARALLAX_ON ? 0.2 : 0) : 0.05;

      gsap.to(corner, {
        x: finalX,
        y: finalY,
        duration,
        ease: duration === 0 ? 'none' : 'power1.out',
        overwrite: 'auto',
      });
    });
  }

  /* ── Helpers ── */
  function addTicker() {
    if (!tickerAdded) {
      gsap.ticker.add(tickerFn);
      tickerAdded = true;
    }
  }

  function removeTicker() {
    if (tickerAdded) {
      gsap.ticker.remove(tickerFn);
      tickerAdded = false;
    }
  }

  function cleanupTarget(target) {
    if (currentLeaveHandler) {
      target.removeEventListener('mouseleave', currentLeaveHandler);
    }
    currentLeaveHandler = null;
  }

  /* ── Mouse move ── */
  window.addEventListener('mousemove', e => moveCursor(e.clientX, e.clientY), { passive: true });

  /* ── Scroll: check if still over active target ── */
  window.addEventListener('scroll', () => {
    if (!activeTarget) return;
    const mouseX = gsap.getProperty(wrapper, 'x');
    const mouseY = gsap.getProperty(wrapper, 'y');
    const el     = document.elementFromPoint(mouseX, mouseY);
    const stillOver = el && (el === activeTarget || el.closest(TARGET_SELECTOR) === activeTarget);
    if (!stillOver && currentLeaveHandler) currentLeaveHandler();
  }, { passive: true });

  /* ── Mouse down / up ── */
  window.addEventListener('mousedown', () => {
    gsap.to(dot,     { scale: 0.7, duration: 0.3 });
    gsap.to(wrapper, { scale: 0.9, duration: 0.2 });
  });
  window.addEventListener('mouseup', () => {
    gsap.to(dot,     { scale: 1, duration: 0.3 });
    gsap.to(wrapper, { scale: 1, duration: 0.2 });
  });

  /* ── Mouse over: enter handler ── */
  window.addEventListener('mouseover', e => {
    /* Walk up the DOM to find the closest cursor-target */
    const allTargets = [];
    let current = e.target;
    while (current && current !== document.body) {
      if (current.matches && current.matches(TARGET_SELECTOR)) allTargets.push(current);
      current = current.parentElement;
    }
    const target = allTargets[0] || null;
    if (!target) return;
    if (activeTarget === target) return;

    if (activeTarget) cleanupTarget(activeTarget);
    if (resumeTimeout) { clearTimeout(resumeTimeout); resumeTimeout = null; }

    activeTarget = target;
    corners.forEach(c => gsap.killTweensOf(c));

    gsap.killTweensOf(wrapper, 'rotation');
    if (spinTl) spinTl.pause();
    gsap.set(wrapper, { rotation: 0 });

    const rect     = target.getBoundingClientRect();
    const cursorX  = gsap.getProperty(wrapper, 'x');
    const cursorY  = gsap.getProperty(wrapper, 'y');

    targetCornerPositions = [
      { x: rect.left  - BORDER_WIDTH,                      y: rect.top    - BORDER_WIDTH },
      { x: rect.right  + BORDER_WIDTH - CORNER_SIZE,       y: rect.top    - BORDER_WIDTH },
      { x: rect.right  + BORDER_WIDTH - CORNER_SIZE,       y: rect.bottom + BORDER_WIDTH - CORNER_SIZE },
      { x: rect.left  - BORDER_WIDTH,                      y: rect.bottom + BORDER_WIDTH - CORNER_SIZE },
    ];

    addTicker();
    gsap.to({ v: 0 }, {
      v: 1,
      duration: HOVER_DURATION,
      ease: 'power2.out',
      onUpdate: function () { activeStrength = this.targets()[0].v; },
    });

    corners.forEach((corner, i) => {
      gsap.to(corner, {
        x: targetCornerPositions[i].x - cursorX,
        y: targetCornerPositions[i].y - cursorY,
        duration: 0.2,
        ease: 'power2.out',
      });
    });

    /* Leave handler */
    const leaveHandler = () => {
      removeTicker();
      activeStrength        = 0;
      targetCornerPositions = null;
      activeTarget          = null;

      corners.forEach(c => gsap.killTweensOf(c));
      const positions = [
        { x: -CORNER_SIZE * 1.5, y: -CORNER_SIZE * 1.5 },
        { x:  CORNER_SIZE * 0.5, y: -CORNER_SIZE * 1.5 },
        { x:  CORNER_SIZE * 0.5, y:  CORNER_SIZE * 0.5 },
        { x: -CORNER_SIZE * 1.5, y:  CORNER_SIZE * 0.5 },
      ];
      const tl = gsap.timeline();
      corners.forEach((corner, i) => {
        tl.to(corner, { x: positions[i].x, y: positions[i].y, duration: 0.3, ease: 'power3.out' }, 0);
      });

      /* Resume spin */
      resumeTimeout = setTimeout(() => {
        if (!activeTarget && spinTl) {
          const currentRotation   = gsap.getProperty(wrapper, 'rotation');
          const normalizedRotation = currentRotation % 360;
          spinTl.kill();
          spinTl = gsap.timeline({ repeat: -1 })
            .to(wrapper, { rotation: '+=360', duration: SPIN_DURATION, ease: 'none' });
          gsap.to(wrapper, {
            rotation: normalizedRotation + 360,
            duration: SPIN_DURATION * (1 - normalizedRotation / 360),
            ease: 'none',
            onComplete: () => { if (spinTl) spinTl.restart(); },
          });
        }
        resumeTimeout = null;
      }, 50);

      cleanupTarget(target);
    };

    currentLeaveHandler = leaveHandler;
    target.addEventListener('mouseleave', leaveHandler);
  }, { passive: true });
})();
