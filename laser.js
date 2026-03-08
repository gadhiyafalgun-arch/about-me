/* ═══════════════════════════════════════════════════════
   laser.js — LaserFlow WebGL Shader (standalone)
   Ported from @react-bits/LaserFlow.
   Raw WebGL — no Three.js dependency.
   Only renders when Skills scene (s7) is in viewport.
   ═══════════════════════════════════════════════════════ */
(function initLaser() {
  const canvas = document.getElementById('laserCanvas');
  const sticky = document.getElementById('skillsSticky');
  if (!canvas || !sticky) return;

  /* ── Sizing with DPR ── */
  const MAX_DPR = 1.5;  // cap for performance
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width  = sticky.clientWidth  * dpr;
    canvas.height = sticky.clientHeight * dpr;
  }
  resize();
  window.addEventListener('resize', resize, { passive: true });

  /* ── WebGL1 context (not WebGL2 — shader uses GL_OES_standard_derivatives) ── */
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl) { canvas.style.display = 'none'; return; }
  gl.getExtension('OES_standard_derivatives');

  /* ── Shaders ── */
  const VERT = `
precision highp float;
attribute vec3 position;
void main() { gl_Position = vec4(position, 1.0); }
  `;

  const FRAG = `
#extension GL_OES_standard_derivatives : enable
#ifdef GL_ES
precision highp float;
precision mediump int;
#endif

uniform float iTime;
uniform vec3  iResolution;
uniform vec4  iMouse;
uniform float uWispDensity, uTiltScale, uFlowTime, uFogTime;
uniform float uBeamXFrac, uBeamYFrac, uFlowSpeed, uVLenFactor, uHLenFactor;
uniform float uFogIntensity, uFogScale, uWSpeed, uWIntensity, uFlowStrength;
uniform float uDecay, uFalloffStart, uFogFallSpeed, uFade;
uniform vec3  uColor;

#define PI           3.14159265359
#define TWO_PI       6.28318530718
#define EPS          1e-6
#define DT_LOCAL     0.0038
#define EDGE_SOFT    (DT_LOCAL*4.0)
#define TAP_RADIUS   6
#define R_H          150.0
#define R_V          150.0
#define FLARE_HEIGHT 16.0
#define FLARE_AMOUNT 8.0
#define FLARE_EXP    2.0
#define TOP_FADE_START 0.1
#define TOP_FADE_EXP   1.0
#define FLOW_PERIOD    0.5
#define FLOW_SHARPNESS 1.5
#define W_BASE_X    1.5
#define W_LAYER_GAP 0.25
#define W_LANES     10
#define W_SIDE_DECAY 0.5
#define W_HALF      0.01
#define W_AA        0.15
#define W_CELL      20.0
#define W_SEG_MIN   0.01
#define W_SEG_MAX   0.55
#define W_CURVE_AMOUNT 15.0
#define W_CURVE_RANGE (FLARE_HEIGHT-3.0)
#define W_BOTTOM_EXP 10.0
#define FOG_CONTRAST 1.2
#define FOG_OCTAVES  5
#define FOG_BOTTOM_BIAS 0.8
#define FOG_TILT_DEADZONE 0.01
#define FOG_TILT_MAX_X    0.35
#define FOG_TILT_SHAPE    1.5
#define FOG_BEAM_MIN 0.0
#define FOG_BEAM_MAX 0.75
#define FOG_MASK_GAMMA 0.5
#define FOG_EXPAND_SHAPE 12.2
#define FOG_EDGE_MIX   0.5
#define HFOG_EDGE_START 0.20
#define HFOG_EDGE_END   0.98
#define HFOG_EDGE_GAMMA 1.4
#define HFOG_Y_RADIUS  25.0
#define HFOG_Y_SOFT    60.0
#define EDGE_X0        0.22
#define EDGE_X1        0.995
#define EDGE_X_GAMMA   1.25
#define EDGE_LUMA_T0   0.0
#define EDGE_LUMA_T1   2.0
#define DITHER_STRENGTH 1.0

float g(float x){return x<=0.00031308?12.92*x:1.055*pow(x,1.0/2.4)-0.055;}
float bs(vec2 p,vec2 q,float powr){
  float d=distance(p,q),f=powr*uFalloffStart,r=(f*f)/(d*d+EPS);
  return powr*min(1.0,r);
}
float bsa(vec2 p,vec2 q,float powr,vec2 s){
  vec2 d=p-q;float dd=(d.x*d.x)/(s.x*s.x)+(d.y*d.y)/(s.y*s.y),f=powr*uFalloffStart,r=(f*f)/(dd+EPS);
  return powr*min(1.0,r);
}
float tri01(float x){float f=fract(x);return 1.0-abs(f*2.0-1.0);}
float tauWf(float t,float tmin,float tmax){
  float a=smoothstep(tmin,tmin+EDGE_SOFT,t),b=1.0-smoothstep(tmax-EDGE_SOFT,tmax,t);
  return max(0.0,a*b);
}
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+34.123);return fract(p.x*p.y);}
float vnoise(vec2 p){
  vec2 i=floor(p),f=fract(p);
  float a=h21(i),b=h21(i+vec2(1,0)),c=h21(i+vec2(0,1)),d=h21(i+vec2(1,1));
  vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float fbm2(vec2 p){
  float v=0.0,amp=0.6;mat2 m=mat2(0.86,0.5,-0.5,0.86);
  for(int i=0;i<FOG_OCTAVES;++i){v+=amp*vnoise(p);p=m*p*2.03+17.1;amp*=0.52;}
  return v;
}
float rGate(float x,float l){return max(0.0,smoothstep(0.0,W_AA,x)*(1.0-smoothstep(l,l+W_AA,x)));}
float flareY(float y){return pow(clamp(1.0-(clamp(y,0.0,FLARE_HEIGHT)/max(FLARE_HEIGHT,EPS)),0.0,1.0),FLARE_EXP);}

float vWisps(vec2 uv,float topF){
  float y=uv.y,yf=(y+uFlowTime*uWSpeed)/W_CELL;
  float dRaw=clamp(uWispDensity,0.0,2.0),d=dRaw<=0.0?1.0:dRaw;
  float lanesF=floor(float(W_LANES)*min(d,1.0)+0.5);
  int lanes=int(max(1.0,lanesF));
  float sp=min(d,1.0),ep=max(d-1.0,0.0);
  float fm=flareY(max(y,0.0)),rm=clamp(1.0-(y/max(W_CURVE_RANGE,EPS)),0.0,1.0),cm=fm*rm;
  const float G=0.05;float xS=1.0+(FLARE_AMOUNT*W_CURVE_AMOUNT*G)*cm;
  float sPix=clamp(y/R_V,0.0,1.0),bGain=pow(1.0-sPix,W_BOTTOM_EXP),sum=0.0;
  for(int s=0;s<2;++s){
    float sgn=s==0?-1.0:1.0;
    for(int i=0;i<W_LANES;++i){
      if(i>=lanes)break;
      float off=W_BASE_X+float(i)*W_LAYER_GAP,xc=sgn*(off*xS);
      float dx=abs(uv.x-xc),lat=1.0-smoothstep(W_HALF,W_HALF+W_AA,dx),amp=exp(-off*W_SIDE_DECAY);
      float seed=h21(vec2(off,sgn*17.0)),yf2=yf+seed*7.0,ci=floor(yf2),fy=fract(yf2);
      float seg=mix(W_SEG_MIN,W_SEG_MAX,h21(vec2(ci,off*2.3)));
      float spR=h21(vec2(ci,off+sgn*31.0)),seg1=rGate(fy,seg)*step(spR,sp);
      if(ep>0.0){float spR2=h21(vec2(ci*3.1+7.0,off*5.3+sgn*13.0));float f2=fract(fy+0.5);seg1+=rGate(f2,seg*0.9)*step(spR2,ep);}
      sum+=amp*lat*seg1;
    }
  }
  float span=smoothstep(-3.0,0.0,y)*(1.0-smoothstep(R_V-6.0,R_V,y));
  return uWIntensity*sum*topF*bGain*span;
}

void mainImage(out vec4 fc,in vec2 frag){
  vec2 C=iResolution.xy*.5;float invW=1.0/max(C.x,1.0);
  float sc=512.0/iResolution.x*.4;
  vec2 uv=(frag-C)*sc,off=vec2(uBeamXFrac*iResolution.x*sc,uBeamYFrac*iResolution.y*sc);
  vec2 uvc=uv-off;
  float a=0.0,b=0.0;
  float basePhase=1.5*PI+uDecay*.5;float tauMin=basePhase-uDecay;float tauMax=basePhase;
  float cx=clamp(uvc.x/(R_H*uHLenFactor),-1.0,1.0),tH=clamp(TWO_PI-acos(cx),tauMin,tauMax);
  for(int k=-TAP_RADIUS;k<=TAP_RADIUS;++k){
    float tu=tH+float(k)*DT_LOCAL,wt=tauWf(tu,tauMin,tauMax);if(wt<=0.0)continue;
    float spd=max(abs(sin(tu)),0.02),u=clamp((basePhase-tu)/max(uDecay,EPS),0.0,1.0),env=pow(1.0-abs(u*2.0-1.0),0.8);
    vec2 p=vec2((R_H*uHLenFactor)*cos(tu),0.0);
    a+=wt*bs(uvc,p,env*spd);
  }
  float yPix=uvc.y,cy=clamp(-yPix/(R_V*uVLenFactor),-1.0,1.0),tV=clamp(TWO_PI-acos(cy),tauMin,tauMax);
  for(int k=-TAP_RADIUS;k<=TAP_RADIUS;++k){
    float tu=tV+float(k)*DT_LOCAL,wt=tauWf(tu,tauMin,tauMax);if(wt<=0.0)continue;
    float yb=(-R_V)*cos(tu),s=clamp(yb/R_V,0.0,1.0),spd=max(abs(sin(tu)),0.02);
    float env=pow(1.0-s,0.6)*spd;
    float cap=1.0-smoothstep(TOP_FADE_START,1.0,s);cap=pow(cap,TOP_FADE_EXP);env*=cap;
    float ph=s/max(FLOW_PERIOD,EPS)+uFlowTime*uFlowSpeed;
    float fl=pow(tri01(ph),FLOW_SHARPNESS);
    env*=mix(1.0-uFlowStrength,1.0,fl);
    float yp=(-R_V*uVLenFactor)*cos(tu),m=pow(smoothstep(FLARE_HEIGHT,0.0,yp),FLARE_EXP),wx=1.0+FLARE_AMOUNT*m;
    vec2 sig=vec2(wx,1.0),p=vec2(0.0,yp);
    float mask=step(0.0,yp);
    b+=wt*bsa(uvc,p,mask*env,sig);
  }
  float sPix=clamp(yPix/R_V,0.0,1.0),topA=pow(1.0-smoothstep(TOP_FADE_START,1.0,sPix),TOP_FADE_EXP);
  float L=a+b*topA;
  float w=vWisps(vec2(uvc.x,yPix),topA);
  float fog=0.0;
  vec2 fuv=uvc*uFogScale;
  float mAct=step(1.0,length(iMouse.xy)),nx=((iMouse.x-C.x)*invW)*mAct;
  float ax=abs(nx);
  float stMag=mix(ax,pow(ax,FOG_TILT_SHAPE),0.35);
  float st=sign(nx)*stMag*uTiltScale;
  st=clamp(st,-FOG_TILT_MAX_X,FOG_TILT_MAX_X);
  vec2 dir=normalize(vec2(st,1.0));
  fuv+=uFogTime*uFogFallSpeed*dir;
  vec2 prp=vec2(-dir.y,dir.x);
  fuv+=prp*(0.08*sin(dot(uvc,prp)*0.08+uFogTime*0.9));
  float n=fbm2(fuv+vec2(fbm2(fuv+vec2(7.3,2.1)),fbm2(fuv+vec2(-3.7,5.9)))*0.6);
  n=pow(clamp(n,0.0,1.0),FOG_CONTRAST);
  float pixW=1.0/max(iResolution.y,1.0);
  float wL=max(fwidth(L),pixW);
  float m0=pow(smoothstep(FOG_BEAM_MIN-wL,FOG_BEAM_MAX+wL,L),FOG_MASK_GAMMA);
  float bm=1.0-pow(1.0-m0,FOG_EXPAND_SHAPE);bm=mix(bm*m0,bm,FOG_EDGE_MIX);
  float yP=1.0-smoothstep(HFOG_Y_RADIUS,HFOG_Y_RADIUS+HFOG_Y_SOFT,abs(yPix));
  float nxF=abs((frag.x-C.x)*invW),hE=1.0-smoothstep(HFOG_EDGE_START,HFOG_EDGE_END,nxF);hE=pow(clamp(hE,0.0,1.0),HFOG_EDGE_GAMMA);
  float hW=mix(1.0,hE,clamp(yP,0.0,1.0));
  float bBias=mix(1.0,1.0-sPix,FOG_BOTTOM_BIAS);
  float radialFade=1.0-smoothstep(0.0,0.7,length(uvc)/120.0);
  fog=n*uFogIntensity*1.8*bBias*bm*hW*radialFade;
  float LF=L+fog;
  float dith=(h21(frag)-0.5)*(DITHER_STRENGTH/255.0);
  float tone=g(LF+w);
  vec3 col=tone*uColor+dith;
  float alpha=clamp(g(L+w*0.6)+dith*0.6,0.0,1.0);
  float nxE=abs((frag.x-C.x)*invW),xF=pow(clamp(1.0-smoothstep(EDGE_X0,EDGE_X1,nxE),0.0,1.0),EDGE_X_GAMMA);
  float scene=LF+max(0.0,w)*0.5,hi=smoothstep(EDGE_LUMA_T0,EDGE_LUMA_T1,scene);
  float eM=mix(xF,1.0,hi);
  col*=eM;alpha*=eM;
  col*=uFade;alpha*=uFade;
  fc=vec4(col,alpha);
}
void main(){vec4 fc;mainImage(fc,gl_FragCoord.xy);gl_FragColor=fc;}
  `;

  /* ── Compile & link ── */
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('LaserFlow shader error:', gl.getShaderInfoLog(s));
    }
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('LaserFlow link error:', gl.getProgramInfoLog(prog));
    return;
  }
  gl.useProgram(prog);

  /* ── Full-screen triangle ── */
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,0, 3,-1,0, -1,3,0]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'position');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

  /* ── Cache uniforms ── */
  const U = {};
  [
    'iTime','iResolution','iMouse',
    'uWispDensity','uTiltScale','uFlowTime','uFogTime',
    'uBeamXFrac','uBeamYFrac','uFlowSpeed','uVLenFactor','uHLenFactor',
    'uFogIntensity','uFogScale','uWSpeed','uWIntensity','uFlowStrength',
    'uDecay','uFalloffStart','uFogFallSpeed','uColor','uFade'
  ].forEach(n => U[n] = gl.getUniformLocation(prog, n));

  /* ── Static uniforms — TUNED for thin beam reaching bottom ── */
  gl.uniform1f(U.uWispDensity,  1.0);
  gl.uniform1f(U.uTiltScale,    0.01);
  gl.uniform1f(U.uBeamXFrac,    0.18);   // offset right (content-aware)
  gl.uniform1f(U.uBeamYFrac,   -0.55);   // beam center above viewport → flows down
  gl.uniform1f(U.uFlowSpeed,    0.35);
  gl.uniform1f(U.uVLenFactor,   3.8);    // tall — reaches bottom
  gl.uniform1f(U.uHLenFactor,   0.15);   // THIN beam
  gl.uniform1f(U.uFogIntensity, 0.30);   // subtle fog
  gl.uniform1f(U.uFogScale,     0.3);
  gl.uniform1f(U.uWSpeed,       15.0);
  gl.uniform1f(U.uWIntensity,   3.0);    // subtle wisps
  gl.uniform1f(U.uFlowStrength, 0.25);
  gl.uniform1f(U.uDecay,        1.1);
  gl.uniform1f(U.uFalloffStart, 1.2);
  gl.uniform1f(U.uFogFallSpeed, 0.6);
  gl.uniform3f(U.uColor, 0.0, 1.0, 0.88);  // cyan #00ffe0

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);  // additive glow

  /* ── State ── */
  let flowTime = 0, fogTime = 0, fade = 0, lastT = 0;
  let lmx = 0, lmy = 0;
  let inView = false;

  /* ── Only render when Skills scene is visible ── */
  const s7 = document.getElementById('s7');
  if (s7) {
    new IntersectionObserver(entries => {
      inView = entries[0].isIntersecting;
    }, { threshold: 0.05 }).observe(s7);
  }

  /* ── Mouse tracking on sticky container ── */
  sticky.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    lmx = (e.clientX - r.left) * dpr;
    lmy = canvas.height - ((e.clientY - r.top) * dpr);
  }, { passive: true });
  sticky.addEventListener('mouseleave', () => { lmx = 0; lmy = 0; }, { passive: true });

  /* ── Render loop ── */
  (function loop(ts) {
    requestAnimationFrame(loop);
    if (document.hidden || !inView) return;  // skip when invisible

    const t  = ts * 0.001;
    const dt = Math.min(0.033, Math.max(0.001, t - lastT));
    lastT = t;
    flowTime += dt;
    fogTime  += dt;
    fade = Math.min(1, fade + dt / 1.2);

    const W = canvas.width, H = canvas.height;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    gl.uniform1f(U.iTime,       t);
    gl.uniform3f(U.iResolution, W, H, dpr);
    gl.uniform4f(U.iMouse,      lmx, lmy, 0, 0);
    gl.uniform1f(U.uFlowTime,   flowTime);
    gl.uniform1f(U.uFogTime,    fogTime);
    gl.uniform1f(U.uFade,       fade);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  })(0);
})();
