'use strict';

/**
 * section-fx.js — Section-specific visual enhancements
 * Fixed version: corrects .tag → .skill-tag, button magnet direction,
 * adds skill bar spark, timeline pulse rings, color bleeding, boot overlay.
 */
(() => {

  /* ─────────────────────────────
     BOOT SEQUENCE — runs first
  ───────────────────────────── */
  const initBootSequence = () => {
    const overlay = document.createElement('div');
    overlay.id = 'page-boot-overlay';
    Object.assign(overlay.style, {
      position:   'fixed',
      inset:      '0',
      background: 'var(--bg)',
      zIndex:     '99999',
      clipPath:   'inset(0 0 0 0)',
      transition: 'clip-path 0.65s cubic-bezier(0.76, 0, 0.24, 1)',
      pointerEvents: 'none',
    });
    document.body.appendChild(overlay);

    /* Small delay so fonts/resources can start loading */
    requestAnimationFrame(() => requestAnimationFrame(() => {
      overlay.style.clipPath = 'inset(0 0 100% 0)';
    }));

    setTimeout(() => overlay.remove(), 750);
  };

  /* ─────────────────────────────
     SCROLL HUD  (bottom-right counter)
  ───────────────────────────── */
  const initScrollHUD = () => {
    const hud = document.createElement('div');
    hud.id = 'scroll-hud';
    Object.assign(hud.style, {
      position:    'fixed',
      bottom:      '24px',
      right:       '24px',
      fontFamily:  "'Space Mono', monospace",
      fontSize:    '0.6rem',
      letterSpacing: '0.12em',
      color:       'var(--muted)',
      opacity:     '0',
      transition:  'opacity 0.35s ease',
      zIndex:      '1001',
      pointerEvents: 'none',
    });
    document.body.appendChild(hud);

    const allSections = Array.from(
      document.querySelectorAll('section[id], .cat-section[id]')
    );
    const total = allSections.length;

    let hideTimer;
    const update = () => {
      hud.style.opacity = '1';
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { hud.style.opacity = '0'; }, 1200);

      const mid = window.scrollY + window.innerHeight * 0.45;
      let idx = 0;
      for (let i = allSections.length - 1; i >= 0; i--) {
        if (allSections[i].offsetTop <= mid) { idx = i; break; }
      }
      hud.textContent = `${String(idx + 1).padStart(2,'0')} / ${String(total).padStart(2,'0')}`;
    };

    window.addEventListener('scroll', update, { passive: true });
  };

  /* ─────────────────────────────
     MAGNETIC BUTTONS
  ───────────────────────────── */
  const initMagneticButtons = () => {
    document.querySelectorAll('.btn-primary, .btn-ghost').forEach(btn => {
      btn.addEventListener('mousemove', e => {
        const r = btn.getBoundingClientRect();
        const cx = r.left + r.width  / 2;
        const cy = r.top  + r.height / 2;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 90) {
          const strength = 0.32 * (1 - dist / 90);
          btn.style.transition = 'transform 0.1s ease';
          btn.style.transform  = `translate(${dx * strength}px, ${dy * strength}px)`;
        }
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transition = 'transform 0.45s cubic-bezier(0.16, 1, 0.3, 1)';
        btn.style.transform  = 'translate(0,0)';
      });
    });
  };

  /* ─────────────────────────────
     KEYWORD PILL HOVER CHARGE
  ───────────────────────────── */
  const initKeywordPills = () => {
    document.querySelectorAll('.cat-kw').forEach(pill => {
      pill.style.transition = 'transform 0.25s ease, box-shadow 0.25s ease, opacity 0.25s ease';
      pill.addEventListener('mouseenter', () => {
        pill.style.transform  = 'scale(1.08)';
        pill.style.boxShadow  = '0 0 12px currentColor';
        pill.style.opacity    = '1';
      });
      pill.addEventListener('mouseleave', () => {
        pill.style.transform  = 'scale(1)';
        pill.style.boxShadow  = 'none';
      });
    });
  };

  /* ─────────────────────────────
     CATEGORY COLOR BLEEDING
     Smoothly tints --accent toward each section's color as you scroll in
  ───────────────────────────── */
  const initColorBleeding = () => {
    const colorMap = {
      quant:   '#00ffe0',
      physics: '#a78bfa',
      ml:      '#f472b6',
      dataeng: '#34d399',
      auto:    '#fb923c',
    };

    const lerp = (a, b, t) => {
      /* Simple hex lerp via RGB */
      const hex = h => [
        parseInt(h.slice(1,3),16),
        parseInt(h.slice(3,5),16),
        parseInt(h.slice(5,7),16),
      ];
      const toHex = n => n.toString(16).padStart(2,'0');
      const ca = hex(a), cb = hex(b);
      const r = Math.round(ca[0] + (cb[0]-ca[0])*t);
      const g = Math.round(ca[1] + (cb[1]-ca[1])*t);
      const bv = Math.round(ca[2] + (cb[2]-ca[2])*t);
      return `#${toHex(r)}${toHex(g)}${toHex(bv)}`;
    };

    const defaultAccent = '#00ffe0';
    let currentColor = defaultAccent;
    let targetColor  = defaultAccent;

    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting && colorMap[e.target.id]) {
          targetColor = colorMap[e.target.id];
        }
        if (!e.isIntersecting) {
          /* Check if any cat section is visible */
          const anyVisible = Object.keys(colorMap).some(id => {
            const el = document.getElementById(id);
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.top < window.innerHeight && r.bottom > 0;
          });
          if (!anyVisible) targetColor = defaultAccent;
        }
      });
    }, { threshold: 0.3 });

    Object.keys(colorMap).forEach(id => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });

    /* Lerp accent color each frame */
    let t = 0;
    const bleedLoop = () => {
      t += 0.04;
      if (t > 1) t = 1;
      if (currentColor !== targetColor) {
        currentColor = lerp(currentColor, targetColor, 0.04);
        document.documentElement.style.setProperty('--accent', currentColor);
      } else {
        t = 0;
      }
      requestAnimationFrame(bleedLoop);
    };
    requestAnimationFrame(bleedLoop);
  };

  /* ─────────────────────────────
     SKILL TAG MAGNETIC GRID
     Fixed: was using '.tag' — corrected to '.skill-tag'
  ───────────────────────────── */
  const initSkillTagMagnet = () => {
    const container = document.querySelector('.skill-tags');
    if (!container) return;

    const tags = () => container.querySelectorAll('.skill-tag');

    container.addEventListener('mousemove', e => {
      const cr = container.getBoundingClientRect();
      const mx = e.clientX - cr.left;
      const my = e.clientY - cr.top;

      tags().forEach(tag => {
        const tr  = tag.getBoundingClientRect();
        const tx  = tr.left - cr.left + tr.width  / 2;
        const ty  = tr.top  - cr.top  + tr.height / 2;
        const dx  = mx - tx;
        const dy  = my - ty;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const maxDist = 130;

        if (dist < maxDist) {
          const force = Math.pow(1 - dist / maxDist, 2) * 0.22;
          tag.style.transition = 'transform 0.15s ease';
          tag.style.transform  = `translate(${dx * force}px, ${dy * force}px)`;
        } else {
          tag.style.transform  = 'translate(0,0)';
        }
      });
    });

    container.addEventListener('mouseleave', () => {
      tags().forEach(tag => {
        tag.style.transition = 'transform 0.5s cubic-bezier(0.16,1,0.3,1)';
        tag.style.transform  = 'translate(0,0)';
      });
    });
  };

  /* ─────────────────────────────
     SKILL BAR SPARK
     A glowing dot rides the leading edge of each bar as it fills
  ───────────────────────────── */
  const initSkillBarSpark = () => {
    /* Wait for bars to start animating (barIO fires at 0.2 threshold) */
    const barObserver = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return;
      barObserver.disconnect();

      document.querySelectorAll('.skill-bar-item').forEach(item => {
        const fill  = item.querySelector('.skill-bar-fill');
        const track = item.querySelector('.skill-bar-track');
        if (!fill || !track) return;

        /* Create spark dot */
        const spark = document.createElement('div');
        Object.assign(spark.style, {
          position:     'absolute',
          top:          '-3px',
          width:        '8px',
          height:       '8px',
          borderRadius: '50%',
          background:   'var(--accent)',
          boxShadow:    '0 0 8px var(--accent), 0 0 16px var(--accent)',
          pointerEvents:'none',
          opacity:      '0',
          transition:   'opacity 0.2s',
          transform:    'translateX(-50%)',
          zIndex:       '2',
        });
        track.style.position = 'relative';
        track.appendChild(spark);

        /* Animate spark following the fill edge */
        const targetW = parseFloat(fill.dataset.w || 0);
        const duration = 1500; /* Match skill-bar-fill transition */
        const startTime = performance.now();

        spark.style.opacity = '1';
        const animSpark = (now) => {
          const elapsed  = now - startTime;
          const progress = Math.min(elapsed / duration, 1);
          const eased    = 1 - Math.pow(1 - progress, 3);
          const pct      = targetW * eased;
          spark.style.left = pct + '%';

          if (progress < 1) {
            requestAnimationFrame(animSpark);
          } else {
            /* Fade out spark when bar finishes */
            spark.style.opacity = '0';
          }
        };

        /* Delay slightly so CSS transition starts first */
        setTimeout(() => requestAnimationFrame(animSpark), 220);
      });
    }, { threshold: 0.2 });

    const skillsEl = document.getElementById('skills');
    if (skillsEl) barObserver.observe(skillsEl);
  };

  /* ─────────────────────────────
     TIMELINE — dot pulse rings + laser line draw
  ───────────────────────────── */
  const initTimelineEffects = () => {
    const timeline = document.getElementById('timeline');
    if (!timeline) return;

    /* Observe timeline container */
    const tlObs = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return;
      tlObs.disconnect();

      /* Laser line: find the ::before pseudo by adding a real element */
      const laser = document.createElement('div');
      Object.assign(laser.style, {
        position:   'absolute',
        left:       '-1px',
        top:        '0',
        width:      '2px',
        height:     '0',
        background: `linear-gradient(to bottom, var(--accent), transparent)`,
        boxShadow:  '0 0 8px var(--accent)',
        transition: 'height 1.4s cubic-bezier(0.76, 0, 0.24, 1)',
        zIndex:     '2',
        pointerEvents: 'none',
      });
      timeline.style.position = 'relative';
      timeline.appendChild(laser);
      requestAnimationFrame(() => {
        laser.style.height = timeline.scrollHeight + 'px';
      });

      /* Dot pulse rings — fire when each tl-item becomes visible */
      const dotObs = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (!e.isIntersecting) return;
          const dot = e.target.querySelector('.tl-dot');
          if (!dot) return;
          dotObs.unobserve(e.target);

          /* Emit 3 rings */
          for (let i = 0; i < 3; i++) {
            setTimeout(() => {
              const ring = document.createElement('div');
              Object.assign(ring.style, {
                position:     'absolute',
                width:        '8px',
                height:       '8px',
                borderRadius: '50%',
                border:       '1px solid var(--accent)',
                top:          '0',
                left:         '0',
                transform:    'scale(1)',
                opacity:      '0.7',
                pointerEvents:'none',
                animation:    'tlRingPulse 0.9s ease-out forwards',
              });
              dot.style.position = 'relative';
              dot.appendChild(ring);
              setTimeout(() => ring.remove(), 950);
            }, i * 200);
          }
        });
      }, { threshold: 0.6 });

      timeline.querySelectorAll('.tl-item').forEach(item => dotObs.observe(item));
    }, { threshold: 0.05 });

    tlObs.observe(timeline);

    /* Inject ring keyframe once */
    if (!document.getElementById('tlRingStyle')) {
      const style = document.createElement('style');
      style.id = 'tlRingStyle';
      style.textContent = `
        @keyframes tlRingPulse {
          0%   { transform: scale(1);  opacity: 0.7; }
          100% { transform: scale(4);  opacity: 0;   }
        }
      `;
      document.head.appendChild(style);
    }
  };

  /* ─────────────────────────────
     INIT ALL
  ───────────────────────────── */
  const init = () => {
    initBootSequence();
    initScrollHUD();
    initMagneticButtons();
    initKeywordPills();
    initColorBleeding();
    initSkillTagMagnet();
    initSkillBarSpark();
    initTimelineEffects();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
