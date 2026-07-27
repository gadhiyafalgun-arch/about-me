/* ═══════════════════════════════════════════════════════
   js/gl/shaders.js — GLSL for the point field.

   Everything that moves per-point lives here. The CPU never touches a particle after upload:
   formation targets go in as static attributes, and the vertex shader interpolates between them.
   That is what keeps 65k points cheaper than the 300 CPU-transformed instances this replaces.
   ═══════════════════════════════════════════════════════ */

/* Classic Perlin 3D + curl, from Stefan Gustavson's implementation (public domain).
   Curl noise gives divergence-free flow — particles drift like a fluid instead of jittering. */
const NOISE = /* glsl */`
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
vec3 fade(vec3 t){ return t*t*t*(t*(t*6.0-15.0)+10.0); }

float cnoise(vec3 P){
  vec3 Pi0 = floor(P), Pi1 = Pi0 + vec3(1.0);
  Pi0 = mod289(Pi0); Pi1 = mod289(Pi1);
  vec3 Pf0 = fract(P), Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz, iz1 = Pi1.zzzz;
  vec4 ixy = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0), ixy1 = permute(ixy + iz1);
  vec4 gx0 = ixy0 * (1.0/7.0);
  vec4 gy0 = fract(floor(gx0) * (1.0/7.0)) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
  vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5);
  gy0 -= sz0 * (step(0.0, gy0) - 0.5);
  vec4 gx1 = ixy1 * (1.0/7.0);
  vec4 gy1 = fract(floor(gx1) * (1.0/7.0)) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
  vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5);
  gy1 -= sz1 * (step(0.0, gy1) - 0.5);
  vec3 g000 = vec3(gx0.x,gy0.x,gz0.x), g100 = vec3(gx0.y,gy0.y,gz0.y);
  vec3 g010 = vec3(gx0.z,gy0.z,gz0.z), g110 = vec3(gx0.w,gy0.w,gz0.w);
  vec3 g001 = vec3(gx1.x,gy1.x,gz1.x), g101 = vec3(gx1.y,gy1.y,gz1.y);
  vec3 g011 = vec3(gx1.z,gy1.z,gz1.z), g111 = vec3(gx1.w,gy1.w,gz1.w);
  vec4 norm0 = taylorInvSqrt(vec4(dot(g000,g000), dot(g010,g010), dot(g100,g100), dot(g110,g110)));
  g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001,g001), dot(g011,g011), dot(g101,g101), dot(g111,g111)));
  g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;
  float n000 = dot(g000, Pf0);
  float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
  float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
  float n111 = dot(g111, Pf1);
  vec3 f = fade(Pf0);
  vec4 nz = mix(vec4(n000,n100,n010,n110), vec4(n001,n101,n011,n111), f.z);
  vec2 nyz = mix(nz.xy, nz.zw, f.y);
  return 2.2 * mix(nyz.x, nyz.y, f.x);
}

vec3 curl(vec3 p){
  const float e = 0.28;
  float x1 = cnoise(vec3(p.x, p.y + e, p.z)),  x2 = cnoise(vec3(p.x, p.y - e, p.z));
  float y1 = cnoise(vec3(p.x, p.y, p.z + e)),  y2 = cnoise(vec3(p.x, p.y, p.z - e));
  float z1 = cnoise(vec3(p.x + e, p.y, p.z)),  z2 = cnoise(vec3(p.x - e, p.y, p.z));
  return normalize(vec3(x1 - x2 - (y1 - y2), y1 - y2 - (z1 - z2), z1 - z2 - (x1 - x2)) + 1e-6);
}
`;

export const VERT = /* glsl */`
precision highp float;

attribute vec3  aPosA;      // formation we are leaving
attribute vec3  aPosB;      // formation we are arriving at
attribute float aSeed;      // stable per-point randomness
attribute float aScale;     // per-point size variance

uniform float uTime;
uniform float uMorph;       // 0 = fully aPosA, 1 = fully aPosB
uniform float uDispersion;  // 0 = calm, 1 = scattered by fast scroll
uniform float uSize;
uniform float uPixelRatio;
uniform vec2  uMouse;       // -1..1, already smoothed on the CPU

varying float vDepth;
varying float vSeed;
varying float vGlow;

${NOISE}

void main() {
  /* ── Morph ──
     Points are offset in time by their seed so the formation reassembles in a wave rather than
     every point arriving at once. That staggering is most of what makes the change read as
     deliberate instead of as a crossfade. */
  float stagger = aSeed * 0.35;
  float t = clamp((uMorph * 1.35) - stagger, 0.0, 1.0);
  t = t * t * (3.0 - 2.0 * t);                       // smoothstep
  vec3 pos = mix(aPosA, aPosB, t);

  /* Mid-morph bulge — points bow outward on their way across so the transition has volume
     rather than sliding along straight lines. */
  float arc = sin(t * 3.14159);
  pos += normalize(pos + 1e-5) * arc * 2.6;

  /* ── Ambient drift ──
     Deliberately small when settled. The geometric formations (the lattice, the network, the
     equalizer bands) carry structure at a scale of a few world units, and a drift much above
     ~0.4 noises that structure away into an even fog. Amplitude opens up mid-morph instead,
     where the extra energy reads as motion rather than as mush. */
  vec3 flow = curl(pos * 0.055 + vec3(0.0, 0.0, uTime * 0.045));
  pos += flow * (0.30 + arc * 1.6);

  /* ── Scroll reaction ──
     Fast scrolling throws the field outward and lets the curl amplitude spike, then it settles
     back as velocity decays. Replaces the separate warp-star canvas this used to need. */
  pos += normalize(pos + 1e-5) * uDispersion * 7.0;
  pos += flow * uDispersion * 5.0;

  /* Cursor parallax — the field leans away from the pointer. */
  pos.xy += uMouse * 1.8 * (1.0 + aSeed);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  vDepth = -mv.z;
  vSeed  = aSeed;
  vGlow  = arc + uDispersion;

  /* Perspective-correct size, clamped so nothing becomes a screen-filling blob up close. */
  float size = aScale * uSize * uPixelRatio * (120.0 / max(vDepth, 1.0));
  gl_PointSize = clamp(size, 0.4, 6.0 * uPixelRatio);
}
`;

export const FRAG = /* glsl */`
precision highp float;

uniform vec3  uColorA;
uniform vec3  uColorB;
uniform float uColorMix;
uniform float uOpacity;

varying float vDepth;
varying float vSeed;
varying float vGlow;

void main() {
  /* Soft round sprite. Squared falloff reads as a glow rather than a disc, and costs one
     multiply — no texture fetch, which keeps this cheap at 65k points. */
  vec2  uv = gl_PointCoord - 0.5;
  float d  = dot(uv, uv);
  if (d > 0.25) discard;
  float alpha = 1.0 - smoothstep(0.0, 0.25, d);
  alpha *= alpha;

  /* Two-tone: the section colour, tinted per point so the field has internal variation instead
     of reading as one flat hue. */
  vec3 col = mix(uColorA, uColorB, clamp(uColorMix + (vSeed - 0.5) * 0.55, 0.0, 1.0));
  col += vGlow * 0.22;

  /* Fade with distance so the far side of the cloud recedes and the field has depth. The near
     bound also fades points that come close to the camera — without it, additive blending piles
     up near the focal plane and the field turns into a bright wall in front of the copy. */
  float depthFade = smoothstep(30.0, 55.0, vDepth) * (1.0 - smoothstep(118.0, 205.0, vDepth));

  /* Deliberately dim. This is atmosphere behind the page, not the subject of it — the text has
     to stay the brightest thing on screen. */
  gl_FragColor = vec4(col, alpha * depthFade * uOpacity * (0.10 + vSeed * 0.36));
}
`;
