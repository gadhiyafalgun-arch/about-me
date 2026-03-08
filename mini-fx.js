/**
 * mini-fx.js — Micro-interactions + visual polish
 *
 *  1. Boot sequence overlay
 *  2. Scroll HUD (section counter)
 *  3. Magnetic buttons
 *  4. Keyword pill hover charge
 *  5. Category color bleeding (--accent per scene)
 *  6. Skill tag magnetic grid
 *  7. Skill bar spark
 *  8. Timeline dot pulse rings + laser line
 *  9. Warp stars & asteroids (fast-scroll streaks)
 * 10. Tile hover 3D reflection + shimmer
 * 11. Glitch intensifier (hero name hover)
 * 12. Mouse parallax on hero elements
 * 13. Section title character reveal
 * 14. Cursor trail particles
 */
'use strict';
(() => {

  /* ─────────────────────────────
     1. BOOT SEQUENCE
  ───────────────────────────── */
  const initBootSequence = () => {
    const overlay = document.createElement('div');
    overlay.id = 'page-boot-overlay';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0',
      background: 'var(--bg)', zIndex: '99999',
      clipPath: 'inset(0 0 0 0)',
      transition: 'clip-path 0.65s cubic-bezier(0.76, 0, 0.24, 1)',
      pointerEvents: 'none',
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      overlay.style.clipPath = 'inset(0 0 100% 0)';
    }));
    setTimeout(() => overlay.remove(), 750);
  };

  /* ─────────────────────────────
     2. SCROLL HUD
  ───────────────────────────── */
  const initScrollHUD = () => {
    const hud = document.createElement('div');
    hud.id = 'scroll-hud';
    Object.assign(hud.style, {
      position: 'fixed', bottom: '24px', right: '24px',
      fontFamily: "'Space Mono', monospace", fontSize: '0.6rem',
      letterSpacing: '0.12em', color: 'var(--muted)',
      opacity: '0', transition: 'opacity 0.35s ease',
      zIndex: '1001', pointerEvents: 'none',
    });
    document.body.appendChild(hud);
    const allScenes = Array.from(document.querySelectorAll('.scene[id]'));
    const total = allScenes.length;
    let hideTimer;
    const update = () => {
      hud.style.opacity = '1';
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { hud.style.opacity = '0'; }, 1200);
      const mid = window.scrollY + window.innerHeight * 0.45;
      let idx = 0;
      for (let i = allScenes.length - 1; i >= 0; i--) {
        if (allScenes[i].offsetTop <= mid) { idx = i; break; }
      }
      hud.textContent = `${String(idx + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
    };
    window.addEventListener('scroll', update, { passive: true });
  };

  /* ─────────────────────────────
     3. MAGNETIC BUTTONS
  ───────────────────────────── */
  const initMagneticButtons = () => {
    document.querySelectorAll('.btn-primary, .btn-ghost').forEach(btn => {
      btn.addEventListener('mousemove', e => {
        const r = btn.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 90) {
          const s = 0.32 * (1 - dist / 90);
          btn.style.transition = 'transform 0.1s ease';
          btn.style.transform = `translate(${dx * s}px, ${dy * s}px)`;
        }
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transition = 'transform 0.45s cubic-bezier(0.16, 1, 0.3, 1)';
        btn.style.transform = 'translate(0,0)';
      });
    });
  };

  /* ─────────────────────────────
     4. KEYWORD PILL HOVER
  ───────────────────────────── */
  const initKeywordPills = () => {
    document.querySelectorAll('.cat-kw').forEach(pill => {
      pill.style.transition = 'transform 0.25s ease, box-shadow 0.25s ease, opacity 0.25s ease';
      pill.addEventListener('mouseenter', () => {
        pill.style.transform = 'scale(1.08)';
        pill.style.boxShadow = '0 0 12px currentColor';
        pill.style.opacity = '1';
      });
      pill.addEventListener('mouseleave', () => {
        pill.style.transform = 'scale(1)';
        pill.style.boxShadow = 'none';
      });
    });
  };

  /* ─────────────────────────────
     5. COLOR BLEEDING
  ───────────────────────────── */
  const initColorBleeding = () => {
    const colorMap = {
      s2: '#00ffe0', s3: '#a78bfa', s4: '#f472b6',
      s5: '#34d399', s6: '#fb923c',
    };
    const hexRgb = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
    const toHex = n => n.toString(16).padStart(2,'0');
    const lerp = (a, b, t) => {
      const ca = hexRgb(a), cb = hexRgb(b);
      return '#' + [0,1,2].map(i => toHex(Math.round(ca[i] + (cb[i]-ca[i])*t))).join('');
    };
    const def = '#00ffe0';
    let cur = def, tgt = def;
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting && colorMap[e.target.id]) tgt = colorMap[e.target.id];
        if (!e.isIntersecting) {
          const any = Object.keys(colorMap).some(id => {
            const el = document.getElementById(id);
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.top < window.innerHeight && r.bottom > 0;
          });
          if (!any) tgt = def;
        }
      });
    }, { threshold: 0.3 });
    Object.keys(colorMap).forEach(id => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    const loop = () => {
      if (cur !== tgt) {
        cur = lerp(cur, tgt, 0.04);
        document.documentElement.style.setProperty('--accent', cur);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };

  /* ─────────────────────────────
     6. SKILL TAG MAGNET
  ───────────────────────────── */
  const initSkillTagMagnet = () => {
    const container = document.querySelector('.skill-tags-wrap');
    if (!container) return;
    const tags = () => container.querySelectorAll('.stag');
    container.addEventListener('mousemove', e => {
      const cr = container.getBoundingClientRect();
      const mx = e.clientX - cr.left, my = e.clientY - cr.top;
      tags().forEach(tag => {
        const tr = tag.getBoundingClientRect();
        const tx = tr.left - cr.left + tr.width / 2;
        const ty = tr.top - cr.top + tr.height / 2;
        const dx = mx - tx, dy = my - ty;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 130) {
          const f = Math.pow(1 - dist / 130, 2) * 0.22;
          tag.style.transition = 'transform 0.15s ease';
          tag.style.transform = `translate(${dx * f}px, ${dy * f}px)`;
        } else {
          tag.style.transform = 'translate(0,0)';
        }
      });
    });
    container.addEventListener('mouseleave', () => {
      tags().forEach(tag => {
        tag.style.transition = 'transform 0.5s cubic-bezier(0.16,1,0.3,1)';
        tag.style.transform = 'translate(0,0)';
      });
    });
  };

  /* ─────────────────────────────
     7. SKILL BAR SPARK
  ───────────────────────────── */
  const initSkillBarSpark = () => {
    const obs = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return;
      obs.disconnect();
      document.querySelectorAll('.skill-bar-item').forEach(item => {
        const fill = item.querySelector('.skill-bar-fill');
        const track = item.querySelector('.skill-bar-track');
        if (!fill || !track) return;
        const spark = document.createElement('div');
        Object.assign(spark.style, {
          position: 'absolute', top: '-3px', width: '8px', height: '8px',
          borderRadius: '50%', background: 'var(--accent)',
          boxShadow: '0 0 8px var(--accent), 0 0 16px var(--accent)',
          pointerEvents: 'none', opacity: '0', transition: 'opacity 0.2s',
          transform: 'translateX(-50%)', zIndex: '2',
        });
        track.style.position = 'relative';
        track.appendChild(spark);
        const targetW = parseFloat(fill.dataset.w || 0);
        const start = performance.now();
        spark.style.opacity = '1';
        const anim = (now) => {
          const p = Math.min((now - start) / 1500, 1);
          const e = 1 - Math.pow(1 - p, 3);
          spark.style.left = (targetW * e) + '%';
          if (p < 1) requestAnimationFrame(anim);
          else spark.style.opacity = '0';
        };
        setTimeout(() => requestAnimationFrame(anim), 220);
      });
    }, { threshold: 0.2 });
    const s7 = document.getElementById('s7');
    if (s7) obs.observe(s7);
  };

  /* ─────────────────────────────
     8. TIMELINE EFFECTS
  ───────────────────────────── */
  const initTimelineEffects = () => {
    const timeline = document.getElementById('timeline');
    if (!timeline) return;
    // Inject pulse ring keyframe
    if (!document.getElementById('tlRingStyle')) {
      const s = document.createElement('style');
      s.id = 'tlRingStyle';
      s.textContent = `@keyframes tlRingPulse{0%{transform:scale(1);opacity:.7}100%{transform:scale(4);opacity:0}}`;
      document.head.appendChild(s);
    }
    const tlObs = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return;
      tlObs.disconnect();
      // Laser line
      const laser = document.createElement('div');
      Object.assign(laser.style, {
        position: 'absolute', left: '-1px', top: '0', width: '2px', height: '0',
        background: 'linear-gradient(to bottom, var(--accent), transparent)',
        boxShadow: '0 0 8px var(--accent)',
        transition: 'height 1.4s cubic-bezier(0.76, 0, 0.24, 1)',
        zIndex: '2', pointerEvents: 'none',
      });
      timeline.style.position = 'relative';
      timeline.appendChild(laser);
      requestAnimationFrame(() => { laser.style.height = timeline.scrollHeight + 'px'; });
      // Dot rings
      const dotObs = new IntersectionObserver(es => {
        es.forEach(e => {
          if (!e.isIntersecting) return;
          const dot = e.target.querySelector('.tl-dot');
          if (!dot) return;
          dotObs.unobserve(e.target);
          for (let i = 0; i < 3; i++) {
            setTimeout(() => {
              const ring = document.createElement('div');
              Object.assign(ring.style, {
                position: 'absolute', width: '8px', height: '8px', borderRadius: '50%',
                border: '1px solid var(--accent)', top: '0', left: '0',
                animation: 'tlRingPulse 0.9s ease-out forwards', pointerEvents: 'none',
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
  };

  /* ─────────────────────────────
     9. WARP STARS
  ───────────────────────────── */
  const initWarpStars = () => {
    const wc = document.getElementById('warpCanvas');
    if (!wc) return;
    const ctx = wc.getContext('2d');
    let W, H, stars = [], warpSpeed = 0;
    let lastSY = window.scrollY, lastST = performance.now();

    function resize() { W = wc.width = window.innerWidth; H = wc.height = window.innerHeight; buildStars(); }
    function newStar(b) {
      const a = Math.random() * Math.PI * 2, d = 10 + Math.random() * 60;
      return { x: W/2 + Math.cos(a)*d, y: H/2 + Math.sin(a)*d, speed: 0.4 + Math.random()*1.5, alpha: b?0:Math.random(), len: 0 };
    }
    function buildStars() { stars = []; for (let i = 0; i < 160; i++) stars.push(newStar(false)); }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    window.addEventListener('scroll', () => {
      const now = performance.now();
      const dy = window.scrollY - lastSY, dt = Math.max(now - lastST, 1);
      warpSpeed = Math.min(Math.abs(dy / dt) * 100, 75);
      lastSY = window.scrollY; lastST = now;
    }, { passive: true });

    let lastT = performance.now();
    function loop(now) {
      const dt = now - lastT; lastT = now;
      ctx.clearRect(0, 0, W, H);
      if (warpSpeed > 0.5) {
        stars.forEach(s => {
          const vx = s.x - W/2, vy = s.y - H/2;
          const mag = Math.sqrt(vx*vx+vy*vy)||1;
          s.x += (vx/mag)*s.speed*warpSpeed*dt*0.06;
          s.y += (vy/mag)*s.speed*warpSpeed*dt*0.06;
          s.len = Math.min(warpSpeed*0.5, 60);
          s.alpha = Math.min(s.alpha+0.02, warpSpeed/60);
          if (s.x<0||s.x>W||s.y<0||s.y>H) Object.assign(s, newStar(true));
          if (s.alpha<=0.01) return;
          const nx = vx/mag, ny = vy/mag;
          const grad = ctx.createLinearGradient(s.x-nx*s.len*0.4,s.y-ny*s.len*0.4,s.x,s.y);
          grad.addColorStop(0,'rgba(0,255,224,0)');
          grad.addColorStop(1,`rgba(0,255,224,${(s.alpha*0.8).toFixed(3)})`);
          ctx.beginPath();
          ctx.moveTo(s.x-nx*s.len*0.4,s.y-ny*s.len*0.4);
          ctx.lineTo(s.x,s.y);
          ctx.strokeStyle=grad; ctx.lineWidth=0.8+warpSpeed/80; ctx.stroke();
        });
      }
      wc.style.opacity = warpSpeed > 5 ? String(Math.min(warpSpeed/75*0.8, 0.8)) : '0';
      requestAnimationFrame(loop);
    }
    loop(performance.now());
  };

  /* ─────────────────────────────
     10. TILE 3D REFLECTION
  ───────────────────────────── */
  const initTileReflection = () => {
    document.querySelectorAll('.project-slot, .physics-card, .contact-row').forEach(tile => {
      const shimmer = document.createElement('div');
      Object.assign(shimmer.style, {
        position: 'absolute', inset: '0',
        background: 'linear-gradient(105deg,transparent 40%,rgba(255,255,255,0.08) 50%,transparent 60%)',
        transform: 'translateX(-100%)', pointerEvents: 'none', zIndex: '10',
      });
      tile.style.position = 'relative';
      tile.style.overflow = 'hidden';
      tile.appendChild(shimmer);
      tile.addEventListener('mousemove', e => {
        const r = tile.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        tile.style.transition = 'transform .1s ease';
        tile.style.transform = `perspective(600px) rotateX(${(y-.5)*10}deg) rotateY(${(x-.5)*-10}deg) scale(1.03)`;
        shimmer.style.transition = 'transform .15s ease';
        shimmer.style.transform = `translateX(${(x*2-1)*120}%)`;
      });
      tile.addEventListener('mouseleave', () => {
        tile.style.transition = 'transform .5s cubic-bezier(.16,1,.3,1)';
        tile.style.transform = '';
        shimmer.style.transition = 'transform .4s ease';
        shimmer.style.transform = 'translateX(100%)';
      });
    });
  };

  /* ─────────────────────────────
     11. GLITCH INTENSIFIER
     Hovering the hero name amplifies the glitch
  ───────────────────────────── */
  const initGlitchHover = () => {
    const glitch = document.querySelector('.glitch');
    if (!glitch) return;
    // Inject intensified keyframes
    if (!document.getElementById('glitchHoverStyle')) {
      const s = document.createElement('style');
      s.id = 'glitchHoverStyle';
      s.textContent = `
        .glitch.intense::before{animation:glitchI1 0.3s steps(2) infinite!important}
        .glitch.intense::after{animation:glitchI2 0.3s steps(2) infinite!important}
        @keyframes glitchI1{0%{transform:translateX(-5px) skewX(-8deg);opacity:.9}50%{transform:translateX(5px) skewX(4deg);opacity:.8}100%{transform:none;opacity:0}}
        @keyframes glitchI2{0%{transform:translateX(4px) skewX(6deg);opacity:.8}50%{transform:translateX(-4px) skewX(-4deg);opacity:.9}100%{transform:none;opacity:0}}
      `;
      document.head.appendChild(s);
    }
    glitch.addEventListener('mouseenter', () => glitch.classList.add('intense'));
    glitch.addEventListener('mouseleave', () => glitch.classList.remove('intense'));
  };

  /* ─────────────────────────────
     12. MOUSE PARALLAX (hero elements)
     Subtle shift based on cursor position
  ───────────────────────────── */
  const initHeroParallax = () => {
    const hero = document.getElementById('c0');
    if (!hero) return;
    const layers = [
      { sel: '.hero-label',  depth: 0.02 },
      { sel: '.hero-h1',     depth: 0.015 },
      { sel: '.hero-sub',    depth: 0.01 },
      { sel: '.hero-right',  depth: -0.025 },
    ];
    const elems = layers.map(l => ({ el: hero.querySelector(l.sel), d: l.depth })).filter(l => l.el);

    document.addEventListener('mousemove', e => {
      const cx = (e.clientX / window.innerWidth  - 0.5) * 2;
      const cy = (e.clientY / window.innerHeight - 0.5) * 2;
      elems.forEach(({ el, d }) => {
        el.style.transition = 'transform 0.3s ease-out';
        el.style.transform = `translate(${cx * d * 100}px, ${cy * d * 100}px)`;
      });
    }, { passive: true });
  };

  /* ─────────────────────────────
     13. SECTION TITLE CHARACTER REVEAL
     Characters fade in one by one when section enters view
  ───────────────────────────── */
  const initCharReveal = () => {
    document.querySelectorAll('.cat-title').forEach(title => {
      // Skip if already processed
      if (title.dataset.revealed) return;
      title.dataset.revealed = 'pending';

      const io = new IntersectionObserver(entries => {
        if (!entries[0].isIntersecting || title.dataset.revealed === 'done') return;
        title.dataset.revealed = 'done';
        io.disconnect();

        // Split text into spans per character (preserve HTML like <br> and <span>)
        const children = Array.from(title.childNodes);
        title.innerHTML = '';
        let charIndex = 0;

        children.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) {
            // Split text characters
            const chars = node.textContent.split('');
            chars.forEach(ch => {
              const span = document.createElement('span');
              span.textContent = ch;
              span.style.cssText = `display:inline-block;opacity:0;transform:translateY(20px);transition:opacity 0.4s ease, transform 0.4s ease;transition-delay:${charIndex * 25}ms`;
              title.appendChild(span);
              charIndex++;
              requestAnimationFrame(() => requestAnimationFrame(() => {
                span.style.opacity = '1';
                span.style.transform = 'translateY(0)';
              }));
            });
          } else {
            // Preserve element nodes (like <br>, <span>)
            const clone = node.cloneNode(true);
            if (clone.nodeType === Node.ELEMENT_NODE && clone.textContent) {
              clone.style.cssText = `display:inline-block;opacity:0;transform:translateY(20px);transition:opacity 0.5s ease, transform 0.5s ease;transition-delay:${charIndex * 25}ms`;
              charIndex += clone.textContent.length;
              requestAnimationFrame(() => requestAnimationFrame(() => {
                clone.style.opacity = '1';
                clone.style.transform = 'translateY(0)';
              }));
            }
            title.appendChild(clone);
          }
        });
      }, { threshold: 0.3 });

      io.observe(title);
    });
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
    initWarpStars();
    initTileReflection();
    initGlitchHover();
    initHeroParallax();
    initCharReveal();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
