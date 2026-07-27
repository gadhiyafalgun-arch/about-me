/* ═══════════════════════════════════════════════════════
   reveal.js — the reveal vocabulary shared by every section.

   Two ideas only:

     1. splitLines()  — wraps each visual line of a heading in an overflow-hidden mask so the
                        line can slide up from beneath its own baseline.
     2. revealScene() — plays a staggered entrance for one section's content, once, on enter.

   Reveals are *triggered*, not scrubbed. Scrubbing a stagger makes elements walk backwards when
   the user scrolls up through it, which reads as broken; a played timeline with a long-tail ease
   is what makes the motion feel authored. Panel crossfades and the WebGL layer stay scrubbed —
   those genuinely are functions of scroll position.
   ═══════════════════════════════════════════════════════ */
'use strict';

/* Long-tail ease. Fast start, very slow settle — the single biggest contributor to motion
   reading as "premium" rather than "animated". */
const EASE_OUT = 'expo.out';

/* Elements that get staggered. Ordered by DOM position within each scene, not by this list.

   Wrappers are deliberately preferred over their children wherever mini-fx.js writes inline
   transforms on hover (magnetic buttons, the skill-tag magnet). Two systems writing the same
   `transform` would fight, so the reveal takes the parent and the hover keeps the child. */
const REVEAL_SELECTOR = [
  /* hero */
  '.hero-label', '.hero-h1', '.hero-sub', '.hero-cta', '.hero-scroll', '.stat-item', '.stat-divider',
  /* category scenes */
  '.cat-eyebrow', '.cat-title', '.cat-sub', '.cat-kw', '.cat-count', '.project-slot',
  /* section headers + skills */
  '.section-header', '.skill-group-title', '.skill-bar-item', '.skill-tags-wrap', '.marquee-wrap',
  /* experience / about / contact */
  '.tl-item', '.about-text > p', '.about-highlight', '.physics-card',
  '.contact-headline', '.contact-sub', '.contact-rows > *',
].join(',');

/* Headings that get the line-mask treatment. */
const LINE_SELECTOR = '.hero-h1, .cat-title, .section-title-big, .contact-headline';

/* ─────────────────────────────────────────────────────
   Split a heading into line masks.

   Lines break at <br> and at block-level children (.accent-word and .cat-title-outline are
   display:block). Element children are moved, never recreated, so ::before/::after content,
   data-text attributes and -webkit-text-stroke all survive intact — this matters for .glitch
   and the outline words.
───────────────────────────────────────────────────── */
function splitLines(el) {
  // Already split — hand back the existing inners. armScene() splits, then revealScene() needs
  // the same nodes to animate; returning an empty list here would silently skip every heading.
  if (el.dataset.split) return Array.from(el.querySelectorAll(':scope > .line-mask > .line-inner'));
  el.dataset.split = '1';

  // Group child nodes into lines.
  const lines = [[]];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeName === 'BR') { lines.push([]); continue; }
    const isBlock = node.nodeType === Node.ELEMENT_NODE &&
                    getComputedStyle(node).display === 'block';
    if (isBlock) { lines.push([node]); lines.push([]); continue; }
    if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) continue;
    lines[lines.length - 1].push(node);
  }

  const inners = [];
  el.textContent = '';
  for (const group of lines) {
    if (!group.length) continue;
    const mask  = document.createElement('span');
    const inner = document.createElement('span');
    mask.className  = 'line-mask';
    inner.className = 'line-inner';
    group.forEach(n => inner.appendChild(n));
    mask.appendChild(inner);
    el.appendChild(mask);
    inners.push(inner);
  }
  return inners;
}

/* ─────────────────────────────────────────────────────
   Reveal one scene's content, once.
───────────────────────────────────────────────────── */
function revealScene(root, reduced) {
  if (!root || root.dataset.revealed) return;
  root.dataset.revealed = '1';

  // Reduced motion: show everything, animate nothing.
  if (reduced) {
    root.querySelectorAll(LINE_SELECTOR).forEach(h => {
      splitLines(h).forEach(i => gsap.set(i, { yPercent: 0, opacity: 1 }));
    });
    gsap.set(root.querySelectorAll(REVEAL_SELECTOR), { opacity: 1, y: 0 });
    return;
  }

  const tl = gsap.timeline({ defaults: { ease: EASE_OUT } });

  // Containers settle first. Some of them (.section-header) wrap a masked heading, so fading the
  // container in underneath the line slide keeps the two from reading as separate events.
  const items = Array.from(root.querySelectorAll(REVEAL_SELECTOR))
    .filter(el => !el.matches(LINE_SELECTOR));
  if (items.length) {
    tl.fromTo(items,
      { opacity: 0, y: 26 },
      { opacity: 1, y: 0, duration: 0.95, stagger: 0.055 }, 0);
  }

  // Headings carry the moment — lines slide up out of their masks, just behind the containers.
  const lineInners = [];
  root.querySelectorAll(LINE_SELECTOR).forEach(h => lineInners.push(...splitLines(h)));
  if (lineInners.length) {
    tl.fromTo(lineInners,
      { yPercent: 118 },
      { yPercent: 0, duration: 1.15, stagger: 0.085 }, 0.15);
  }

  return tl;
}

/* Pre-hide reveal targets so there is no flash before the trigger fires. Only ever called when
   the scene engine is confirmed running, so a script failure can't leave content hidden. */
function armScene(root, reduced) {
  if (!root || reduced) return;
  root.querySelectorAll(LINE_SELECTOR).forEach(h => {
    splitLines(h).forEach(i => gsap.set(i, { yPercent: 118 }));
  });
  const items = Array.from(root.querySelectorAll(REVEAL_SELECTOR))
    .filter(el => !el.matches(LINE_SELECTOR));
  gsap.set(items, { opacity: 0, y: 26 });
}

window.Reveal = { revealScene, armScene, splitLines, EASE_OUT };
