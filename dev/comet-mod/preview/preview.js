/* Comet FX 预览台 —— 图案公式与 Java 侧 CometGeometry / CometEase 逐字对应 */
'use strict';

const TAU = Math.PI * 2;
const $ = (id) => document.getElementById(id);
const mod = (a, n) => { const r = a % n; return r < 0 ? r + n : r; };
const clamp01 = (x) => x < 0 ? 0 : (x > 1 ? 1 : x);

/* ---------------------------------------------------------------- 形状（= CometGeometry.java） */
const GEOMETRY = ['五芒星', '六芒星', '三角阵', '菱形', '六边形', '花瓣', '齿轮', '螺旋', '星轨'];
const MOTION = ['极光', '彩虹', '波浪', '脉冲', '旋转', '双层', '粒子', '音乐律动'];
const ALL_MODES = [...GEOMETRY, ...MOTION];
const TIPS = { 五芒星: 5, 六芒星: 6, 三角阵: 3, 菱形: 2, 六边形: 6, 花瓣: 8, 齿轮: 12, 螺旋: 0, 星轨: 0 };

function star(n, inner, a, rad, phase) {
  const seg = TAU / n, u = mod(a + phase, seg), half = seg / 2;
  const f = u < half ? 1 - u / half : (u - half) / half;
  return rad * (inner + (1 - inner) * f);
}
function poly(n, a, rad, phase) {
  const seg = TAU / n, u = mod(a + phase, seg);
  return rad * Math.cos(Math.PI / n) / Math.max(0.2, Math.cos(u - seg / 2));
}
function shapeRadius(shape, a, rad, t, phase) {
  switch (shape) {
    case '五芒星': return star(5, .44, a, rad, phase) * (1 + .06 * Math.sin(t * 2.4));
    case '六芒星': return star(6, .50, a, rad, phase);
    case '三角阵': return star(3, .42, a, rad, phase);
    case '菱形': return poly(4, a, rad, phase);
    case '六边形': return poly(6, a, rad, phase);
    case '花瓣': return rad * (.66 + .34 * Math.abs(Math.cos(4 * (a + phase * .4))));
    case '齿轮': return rad * (.88 + .12 * (Math.cos(12 * (a + phase)) > 0 ? 1 : 0));
    case '螺旋': return rad * (.35 + .65 * mod(a + t * .8 + phase, TAU) / TAU);
    case '星轨': return rad * (1 + .03 * Math.sin(a * 24 + t * 4));
    default: return rad;
  }
}
const tipCount = (m) => TIPS[m] || 0;

/* ---------------------------------------------------------------- 缓动（= CometEase.java） */
const easeInOut = (x) => { x = clamp01(x); return x < .5 ? 4*x*x*x : 1 - Math.pow(-2*x+2, 3)/2; };
const easeOut = (x) => { x = clamp01(x); return 1 - Math.pow(1-x, 3); };
const window01 = (p, a, b) => b <= a ? 0 : clamp01((p-a)/(b-a));

/* ---------------------------------------------------------------- 颜色（= CometColor.java） */
function hsv(h, s, v) {
  h = mod(h, 360);
  const i = Math.floor(h/60) % 6, f = h/60 - Math.floor(h/60);
  const p = v*(1-s), q = v*(1-f*s), t = v*(1-(1-f)*s);
  const c = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i];
  return c.map(x => Math.round(x*255));
}
function rainbow(t, phase, alpha) {
  const c = hsv((t*55 + phase*360/TAU) % 360, .85, .95);
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}
/** 直接按色相角取彩虹色，让一圈铺满 360°（不要用 phase 当色相，会只跨 31°） */
function rainbowHue(hueDeg, alpha) {
  const c = hsv(hueDeg, .82, .96);
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}
function accentRgb() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const h = v.replace('#','');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

/* ---------------------------------------------------------------- 状态 */
const S = {
  mode: '五芒星', radius: 2.6, speed: 1, layers: 1, particles: 40,
  rainbow: true, pulse: true, glow: true, trail: false, tips: true,
  esp: true, hud: true, yaw: .55, dist: 13, t: 0,
};

/* ---------------------------------------------------------------- 世界画布 */
const cv = $('world'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.floor(W * DPR); cv.height = Math.floor(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);
resize();

/* 相机：把世界点投到屏幕（俯视 + 透视压缩，够用来看形状） */
function project(x, y, z) {
  const c = Math.cos(S.yaw), s = Math.sin(S.yaw);
  const rx = x*c - z*s, rz = x*s + z*c;
  const scale = (S.dist * 34) / (S.dist + rz * .55);
  return { x: W*.54 + rx*scale, y: H*.63 + (y-1)*scale*.42 - rz*scale*.58, s: scale };
}

function drawBackdrop() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0c1120'); g.addColorStop(.52, '#1b2540'); g.addColorStop(1, '#0a0d16');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // 远处光晕
  const rg = ctx.createRadialGradient(W*.54, H*.42, 10, W*.54, H*.42, Math.max(W,H)*.55);
  rg.addColorStop(0, 'rgba(120,105,220,.14)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);

  // 地面网格
  ctx.lineWidth = 1;
  for (let i = -14; i <= 14; i++) {
    ctx.beginPath();
    let a = project(i, 0, -14), b = project(i, 0, 14);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = i === 0 ? 'rgba(176,107,255,.20)' : 'rgba(150,170,220,.075)';
    ctx.stroke();
    a = project(-14, 0, i); b = project(14, 0, i);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = i === 0 ? 'rgba(176,107,255,.20)' : 'rgba(150,170,220,.075)';
    ctx.stroke();
  }

  // 几个方块，给 3D 线框一个参照
  drawBlock(-4.5, -3, .9, '#2a3550', 'rgba(120,150,220,.30)');
  drawBlock(5.2, 1.5, 1.3, '#2b2f48', 'rgba(150,130,220,.28)');
  drawBlock(-1.5, 5.5, .7, '#253047', 'rgba(110,160,210,.24)');
}

function drawBlock(x, z, h, fill, stroke) {
  const c = [[x-.5,0,z-.5],[x+.5,0,z-.5],[x+.5,0,z+.5],[x-.5,0,z+.5],
             [x-.5,h,z-.5],[x+.5,h,z-.5],[x+.5,h,z+.5],[x-.5,h,z+.5]].map(p => project(...p));
  const faces = [[0,1,5,4],[1,2,6,5],[4,5,6,7]];
  for (const f of faces) {
    ctx.beginPath(); ctx.moveTo(c[f[0]].x, c[f[0]].y);
    for (let i=1;i<4;i++) ctx.lineTo(c[f[i]].x, c[f[i]].y);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
  }
}

/* ---------------------------------------------------------------- 光环 */
function drawAura() {
  const seg = 240;
  const spin = S.t * S.speed;
  const pulse = S.pulse ? 1 + .06 * Math.sin(S.t * 2.4) : 1;
  const [ar, ag, ab] = accentRgb();

  for (let L = 0; L < S.layers; L++) {
    const rr = S.radius * pulse * (1 - L * .18);
    const yLift = L * .22;
    const phase = spin + L * .7;
    const alpha = .9 * (1 - L * .22);

    // 辉光：同图案用低 alpha 画三遍（对应 Java 侧的便宜辉光路径）
    const passes = S.glow ? [{o: .02, a: alpha*.14, w: 6}, {o: 0, a: alpha, w: 2.4}] : [{o:0,a:alpha,w:2.4}];
    for (const ps of passes) {
      ctx.lineWidth = ps.w; ctx.lineJoin = 'round';
      for (let i = 0; i < seg; i++) {
        const a1 = TAU*i/seg, a2 = TAU*(i+1)/seg;
        // phase 只通过函数参数传一次；再往角度里加一次会把形状扭歪
        const r1 = (rr+ps.o) * shapeRadius(S.mode, a1, 1, S.t, phase);
        const r2 = (rr+ps.o) * shapeRadius(S.mode, a2, 1, S.t, phase);
        const p1 = project(Math.cos(a1)*r1, yLift, Math.sin(a1)*r1);
        const p2 = project(Math.cos(a2)*r2, yLift, Math.sin(a2)*r2);
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = S.rainbow ? rainbowHue(i/seg*360 + S.t*40 + L*20, ps.a)
                                    : `rgba(${ar},${ag},${ab},${ps.a})`;
        ctx.stroke();
      }
    }

    // 尖角发光点 + pentagram 内接跳点
    const n = tipCount(S.mode);
    const color = S.rainbow ? rainbowHue(S.t*40 + L*20, .95) : `rgba(${ar},${ag},${ab},.95)`;
    if (n > 0 && S.tips) {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = phase + TAU*i/n;
        const r = rr * shapeRadius(S.mode, a, 1, S.t, phase);
        const p = project(Math.cos(a)*r, yLift, Math.sin(a)*r);
        pts.push(p);
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 11);
        glow.addColorStop(0, color); glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, TAU); ctx.fill();
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, TAU); ctx.fill();
      }
      if ((S.mode === '五芒星' || S.mode === '六芒星') && pts.length > 2) {
        ctx.strokeStyle = S.rainbow ? rainbowHue(S.t*40 + L*20, .28) : `rgba(${ar},${ag},${ab},.22)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const p = pts[(i+2)%n];
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath(); ctx.stroke();
      }
    }
  }

  // 环绕粒子（确定性，不用 Math.random）
  const count = S.particles;
  for (let i = 0; i < count; i++) {
    const a = S.t*.6 + i*2.399963;
    const frac = mod(i*.618, 1);
    const rr = S.radius * (.6 + .4*frac);
    const yy = .3 + 1.2*(x => x - Math.floor(x))(Math.sin(i*12.9898)*43758.5453) + .25*Math.sin(S.t*1.7+i);
    const p = project(Math.cos(a)*rr, yy, Math.sin(a)*rr);
    const c = S.rainbow ? rainbowHue(i*3 + S.t*40, .62) : `rgba(${ar},${ag},${ab},.62)`;
    ctx.globalAlpha = .55; ctx.fillStyle = c; ctx.fillRect(p.x-.8, p.y-2, 1.6, 3); ctx.globalAlpha = 1;
  }
}

/* ---------------------------------------------------------------- ESP 线框 / 追踪线 */
function drawEsp() {
  if (!S.esp) return;
  const boxes = [
    { x:-4.5, z:-3, w:1.1, h:2.0, c:'rgba(255,110,140,.85)' },
    { x: 5.2, z: 1.5, w:1.1, h:2.0, c:'rgba(110,220,255,.85)' },
    { x: 2.0, z:-6.0, w:.9, h:1.7, c:'rgba(180,255,140,.80)' },
  ];
  const center = { x: W*.5, y: H*.5 };

  for (const b of boxes) {
    const hw = b.w/2;
    const v = [[b.x-hw,0,b.z-hw],[b.x+hw,0,b.z-hw],[b.x+hw,0,b.z+hw],[b.x-hw,0,b.z+hw],
               [b.x-hw,b.h,b.z-hw],[b.x+hw,b.h,b.z-hw],[b.x+hw,b.h,b.z+hw],[b.x-hw,b.h,b.z+hw]]
              .map(p => project(...p));
    const edges = [[0,4],[1,5],[2,6],[3,7],[0,1],[2,3],[0,2],[1,3],[4,5],[6,7],[4,6],[5,7]];
    ctx.strokeStyle = b.c; ctx.lineWidth = 1.6; ctx.shadowColor = b.c; ctx.shadowBlur = 7;
    ctx.beginPath();
    for (const [i,j] of edges) { ctx.moveTo(v[i].x, v[i].y); ctx.lineTo(v[j].x, v[j].y); }
    ctx.stroke(); ctx.shadowBlur = 0;

    // 追踪线（准星 → 实体中心）
    const mid = project(b.x, b.h/2, b.z);
    const g = ctx.createLinearGradient(center.x, center.y, mid.x, mid.y);
    g.addColorStop(0, 'rgba(255,255,255,.06)'); g.addColorStop(1, b.c);
    ctx.strokeStyle = g; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(center.x, center.y); ctx.lineTo(mid.x, mid.y); ctx.stroke();

    // 四角括号
    const xs = [Math.min(...v.map(p=>p.x)), Math.max(...v.map(p=>p.x))];
    const ys = [Math.min(...v.map(p=>p.y)), Math.max(...v.map(p=>p.y))];
    const k = Math.min(xs[1]-xs[0], ys[1]-ys[0]) * .22;
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [cx,cy,dx,dy] of [[xs[0],ys[0],1,1],[xs[1],ys[0],-1,1],[xs[0],ys[1],1,-1],[xs[1],ys[1],-1,-1]]) {
      ctx.moveTo(cx+dx*k, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy+dy*k);
    }
    ctx.stroke();
  }

  // 落点圈
  const land = project(3.4, 0, -1.2);
  ctx.strokeStyle = 'rgba(120,220,255,.65)'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.ellipse(land.x, land.y, 16, 7, 0, 0, TAU); ctx.stroke();
}

/* ---------------------------------------------------------------- 雷达 */
const radar = $('radar'), rctx = radar.getContext('2d');
function drawRadar() {
  const w = radar.width, h = radar.height, cx = w/2, cy = h/2, R = w/2 - 8;
  rctx.clearRect(0,0,w,h);
  rctx.fillStyle = 'rgba(10,13,22,.55)'; rctx.beginPath(); rctx.arc(cx,cy,R,0,TAU); rctx.fill();
  rctx.strokeStyle = 'rgba(255,255,255,.10)'; rctx.lineWidth = 1;
  for (const r of [R*.33, R*.66, R]) { rctx.beginPath(); rctx.arc(cx,cy,r,0,TAU); rctx.stroke(); }
  rctx.beginPath(); rctx.moveTo(cx,cy-R); rctx.lineTo(cx,cy+R); rctx.moveTo(cx-R,cy); rctx.lineTo(cx+R,cy); rctx.stroke();
  rctx.fillStyle = 'rgba(255,255,255,.7)'; rctx.font = '20px sans-serif'; rctx.textAlign = 'center';
  rctx.fillText('N', cx, cy-R+22);
  const dots = [[.3,-.2,'#ff6e8c'],[-.45,.35,'#6edcff'],[.55,.5,'#b4ff8c'],[-.2,-.6,'#ffd166']];
  for (const [dx,dy,c] of dots) {
    const a = S.t*.12;
    const x = cx + (dx*Math.cos(a)-dy*Math.sin(a))*R*.8;
    const y = cy + (dx*Math.sin(a)+dy*Math.cos(a))*R*.8;
    rctx.fillStyle = c; rctx.shadowColor = c; rctx.shadowBlur = 10;
    rctx.beginPath(); rctx.arc(x,y,5,0,TAU); rctx.fill();
  }
  rctx.shadowBlur = 0;
  const [ar,ag,ab] = accentRgb();
  rctx.fillStyle = `rgba(${ar},${ag},${ab},1)`;
  rctx.beginPath(); rctx.moveTo(cx,cy-9); rctx.lineTo(cx-6,cy+7); rctx.lineTo(cx+6,cy+7); rctx.closePath(); rctx.fill();
}

/* ---------------------------------------------------------------- 通知 */
const NOTES = [
  ['材质包', 'CozyUI 已应用'], ['光环', '图案切换为五芒星'],
  ['ESP', '发现 3 个实体'], ['毛玻璃', '模糊管线已就绪'],
];
let noteIdx = 0;
function pushNote() {
  if (!S.hud) return;
  const box = $('hud-notes');
  const el = document.createElement('div');
  el.className = 'note glass';
  const [k,v] = NOTES[noteIdx++ % NOTES.length];
  el.innerHTML = `<b>${k}</b>${v}`;
  box.appendChild(el);
  while (box.children.length > 3) box.removeChild(box.firstChild);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 2600);
}
setInterval(pushNote, 3400);
setTimeout(pushNote, 700);

/* ---------------------------------------------------------------- 开场动画 */
const intro = $('intro'), icv = $('intro-cv'), ictx = icv.getContext('2d');
let introStart = 0, introActive = false, introTimer = 0;
function playIntro() {
  if (introActive) return;
  introActive = true;
  intro.classList.add('on'); intro.classList.remove('fade');
  const dpr = Math.min(window.devicePixelRatio||1, 2);
  icv.width = Math.floor(W*dpr); icv.height = Math.floor(H*dpr);
  ictx.setTransform(dpr,0,0,dpr,0,0);
  introStart = performance.now();
  cancelAnimationFrame(introTimer);
  introTimer = requestAnimationFrame(drawIntro);
}
function finishIntro() {
  if (!introActive) return;
  introActive = false; cancelAnimationFrame(introTimer);
  intro.classList.add('fade');
  setTimeout(() => { intro.classList.remove('on','fade'); }, 560);
}
intro.addEventListener('click', finishIntro);
$('play-intro').addEventListener('click', playIntro);

function drawIntro(now) {
  if (!introActive) return;
  const p = Math.min(1, (now - introStart) / 3000);
  // = CometEase.introPhases
  const fadeOut = clamp01(1 - Math.max(0, (p - .82)/.18));
  const veil = p < .08 ? p/.08 : (p > .86 ? fadeOut : 1);
  const assemble = easeInOut(window01(p, .10, .65));
  const textA = clamp01(easeInOut(window01(p, .30, .50)) * fadeOut);
  const spin = p * TAU * 1.7;
  const drawN = Math.max(2, Math.floor(240*assemble));
  const settle = 1 - assemble;
  const [ar,ag,ab] = accentRgb();
  const cx = W/2, cy = H/2, R = Math.min(W,H)*.24;

  ictx.fillStyle = `rgba(0,0,0,${.985*veil})`; ictx.fillRect(0,0,W,H);

  // 110 颗粒子汇聚
  for (let i=0;i<110;i++) {
    const a = i*2.399963, spread = (1-assemble)*Math.max(W,H)*.6;
    const rr = R*(.2+.8*mod(i*.618,1)) + spread;
    const x = cx + Math.cos(a+spin*.3)*rr, y = cy + Math.sin(a+spin*.3)*rr;
    ictx.fillStyle = `rgba(150,180,240,${.55*assemble*fadeOut})`;
    ictx.fillRect(x,y,2,2);
  }

  // 3 层同形状，逐段组装 + 碎片归位
  for (let L=0;L<3;L++) {
    const rr = R*(1-L*.22);
    ictx.lineWidth = 2; ictx.strokeStyle = `rgba(150,190,255,${(.78*fadeOut*(1-L*.22)).toFixed(3)})`;
    ictx.beginPath();
    for (let i=0;i<drawN;i++) {
      const a = TAU*i/240 + spin + L*.7;
      const jx = Math.sin(i*12.9898 + L*7.1)*settle*.35;
      const jy = Math.cos(i*78.233 + L*3.3)*settle*.35;
      const r = rr*shapeRadius(S.mode, a - spin - L*.7, 1, p, spin + L*.7);
      const x = cx + Math.cos(a)*r + jx*70, y = cy + Math.sin(a)*r*.55 + jy*70;
      if (i===0) ictx.moveTo(x,y); else ictx.lineTo(x,y);
    }
    ictx.stroke();
  }
  // 构图同心圆
  ictx.strokeStyle = `rgba(150,180,240,${(.18*assemble*fadeOut).toFixed(3)})`;
  ictx.lineWidth = 1;
  for (const k of [1.25, 1.55]) { ictx.beginPath(); ictx.ellipse(cx,cy,R*k,R*k*.55,0,0,TAU); ictx.stroke(); }
  // 3 道扩散光环
  for (let k=0;k<3;k++) {
    const q = mod(p*1.35 - k*.16, 1);
    ictx.strokeStyle = `rgba(150,190,255,${(.3*(1-q)*fadeOut).toFixed(3)})`;
    ictx.beginPath(); ictx.ellipse(cx,cy,R*(.4+q*1.6),R*(.4+q*1.6)*.55,0,0,TAU); ictx.stroke();
  }
  // 中央文字
  ictx.textAlign = 'center'; ictx.fillStyle = `rgba(240,242,255,${textA})`;
  ictx.font = '600 34px "Segoe UI", sans-serif'; ictx.fillText('COMET FX', cx, cy+10);
  ictx.font = '13px "Segoe UI", sans-serif'; ictx.fillStyle = `rgba(${ar},${ag},${ab},${textA})`;
  ictx.fillText('v0.1 · Meteor Client 26.3', cx, cy+36);

  if (p >= 1) finishIntro(); else introTimer = requestAnimationFrame(drawIntro);
}

/* ---------------------------------------------------------------- 交互 */
const modeSel = $('mode');
ALL_MODES.forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = m; modeSel.appendChild(o); });
modeSel.value = S.mode;
modeSel.addEventListener('change', e => { S.mode = e.target.value; pushModeNote(); });
function pushModeNote() {
  const box = $('hud-notes'); if (!box) return;
  const el = document.createElement('div'); el.className = 'note glass';
  el.innerHTML = `<b>光环</b>图案切换为 ${S.mode}`;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(()=>el.remove(),320); }, 2200);
}

function bindRange(id, key, fmt) {
  const el = $(id), out = $('v-'+id);
  const apply = () => { S[key] = parseFloat(el.value); out.textContent = fmt ? fmt(S[key]) : S[key]; paintRange(el); };
  el.addEventListener('input', apply); apply();
}
function paintRange(el) {
  const p = (el.value - el.min)/(el.max - el.min)*100;
  el.style.background = `linear-gradient(90deg, var(--accent) 0%, var(--accent) ${p}%, rgba(255,255,255,.14) ${p}%)`;
}
bindRange('radius','radius', v=>v.toFixed(1));
bindRange('speed','speed', v=>v.toFixed(1));
bindRange('layers','layers', v=>String(v));
bindRange('particles','particles', v=>String(v));

for (const [id,key] of [['rainbow','rainbow'],['pulse','pulse'],['glow','glow'],['trail','trail'],['tips','tips'],['esp','esp'],['hud','hud']]) {
  const el = $(id);
  el.addEventListener('change', () => {
    S[key] = el.checked;
    if (key === 'hud') document.querySelectorAll('.hud').forEach(n => n.classList.toggle('hud-off', !el.checked));
  });
}

// 玻璃参数（纯 CSS 变量，不改 DOM 内联样式属性以外的东西）
function bindCss(id, varName, outId, suffix) {
  const el = $(id), out = $(outId);
  const apply = () => {
    document.documentElement.style.setProperty(varName, suffix ? el.value + suffix : el.value);
    out.textContent = el.value; paintRange(el);
  };
  el.addEventListener('input', apply); apply();
}
bindCss('blur','--blur','v-blur','px');
bindCss('sat','--saturate','v-sat','%');
bindCss('round','--radius','v-round','');
$('lg-blur').textContent = $('blur').value;
$('lg-sat').textContent = $('sat').value;
$('blur').addEventListener('input', () => $('lg-blur').textContent = $('blur').value);
$('sat').addEventListener('input', () => $('lg-sat').textContent = $('sat').value);

const PRESETS = {
  '绚丽': { accent:'#b06bff', glow:'14px', blur:18, radius:14, anim:1.3, saturate:1.5, bg:'#10121c', border:.75 },
  '平缓': { accent:'#6f9bd1', glow:'5px', blur:8,  radius:9,  anim:.6,  saturate:1.05, bg:'#141821', border:.45 },
  '基本': { accent:'#8a8f99', glow:'0px',  blur:0,   radius:4,  anim:0,   saturate:.8,  bg:'#0d1016', border:.25 },
};
document.querySelectorAll('[data-preset]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    const p = PRESETS[btn.dataset.preset];
    const root = document.documentElement.style;
    root.setProperty('--accent', p.accent);
    root.setProperty('--glow', p.glow);
    root.setProperty('--radius', p.radius);
    root.setProperty('--blur', p.blur + 'px');
    root.setProperty('--saturate', (p.saturate*100) + '%');
    $('blur').value = p.blur; $('sat').value = p.saturate*100; $('round').value = p.radius;
    paintRange($('blur')); paintRange($('sat')); paintRange($('round'));
    $('v-blur').textContent = p.blur; $('v-sat').textContent = p.saturate*100; $('v-round').textContent = p.radius;
    $('lg-blur').textContent = p.blur; $('lg-sat').textContent = p.saturate*100;
    document.querySelectorAll('.glass').forEach(n => n.classList.toggle('glass-flat', p.blur === 0));
  });
});

let cycling = false, cycleTimer = 0;
$('cycle').addEventListener('click', () => {
  cycling = !cycling;
  $('cycle').textContent = cycling ? '停止循环' : '循环切换图案';
  if (cycling) cycleTimer = setInterval(() => {
    const i = (ALL_MODES.indexOf(S.mode)+1) % ALL_MODES.length;
    modeSel.value = ALL_MODES[i]; S.mode = ALL_MODES[i]; pushModeNote();
  }, 1600);
  else clearInterval(cycleTimer);
});
$('reset').addEventListener('click', () => location.reload());

// 拖动旋转视角
let dragging = false, lastX = 0;
window.addEventListener('mousedown', e => { if (e.target.closest('#controls')) return; dragging = true; lastX = e.clientX; });
window.addEventListener('mouseup', () => dragging = false);
window.addEventListener('mousemove', e => { if (dragging) { S.yaw += (e.clientX-lastX)*.005; lastX = e.clientX; } });
window.addEventListener('wheel', e => { S.dist = Math.max(7, Math.min(24, S.dist + e.deltaY*.01)); }, {passive:true});

/* ---------------------------------------------------------------- 主循环 */
let last = performance.now();
function frame(now) {
  const dt = Math.min(.05, (now-last)/1000); last = now; S.t += dt;
  if (S.trail) { ctx.fillStyle = 'rgba(11,13,20,.18)'; ctx.fillRect(0,0,W,H); }
  else drawBackdrop();
  drawAura();
  drawEsp();
  drawRadar();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// 默认双击打开会播开场动画；?nointro=1 用于自动化截图 / 直接看静态效果
const skipIntro = new URLSearchParams(location.search).get('nointro') === '1';
if (!skipIntro) setTimeout(playIntro, 400);
