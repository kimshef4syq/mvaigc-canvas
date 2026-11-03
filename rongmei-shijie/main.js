import * as UI from './ui.js';
import * as FM from './film.js';

const wL = document.getElementById('wL'), wO = document.getElementById('wO'), spr = document.getElementById('spr'), hudEl = document.getElementById('hud');
const Q = new URLSearchParams(location.search), NOSUBS = Q.has('nosubs');
const WIN = { x: 180, y: 110, w: 1560, h: 840 };
const tf = ([cx, cy, z]) => `translate(960px,540px) scale(${z}) translate(${-cx}px,${-cy}px)`;

function render(t) {
  const F = FM.frame(t);
  const [cx, cy, z] = F.cam;
  wL.innerHTML = UI.desk({}) + (F.full ? F.screen : UI.win({
    x: WIN.x, y: WIN.y, w: WIN.w, h: WIN.h, title: F.winTitle || '融媒视界', rt: F.rt ?? '融媒视界 · mvaigc.cn',
    rail: F.rail === '' ? '' : UI.rail(F.rail || '我的项目'), top: F.topHtml || '', body: F.screen,
  }));
  wL.style.transform = tf(F.cam); wO.style.transform = tf(F.cam); spr.style.transform = tf(F.cam);
  // 圆形遮罩转场：wO 是"被撑开的新页面"，按圆裁剪
  if (F.overlay) {
    wO.innerHTML = UI.desk({}) + UI.win({ x: WIN.x, y: WIN.y, w: WIN.w, h: WIN.h, title: F.overlayTitle || '融媒视界',
      rt: F.overlayRt ?? '融媒视界 · mvaigc.cn', rail: F.overlayRail === '' ? '' : UI.rail(F.overlayRail || '我的项目'),
      top: F.overlayTop || '', body: F.overlay });
    wO.style.display = '';
  } else { wO.innerHTML = ''; wO.style.display = 'none'; }
  // 页面内滚动（主页向下浏览）
  const hw = wL.querySelector('.homewrap');
  if (hw && F.scrollY) hw.style.transform = `translateY(${-F.scrollY}px)`;

  // 锚点：从 DOM 量取（每帧实时，不手写坐标）
  const cache = {};
  const A = (key, fx = .5, fy = 0) => {
    const el = cache[key] !== undefined ? cache[key] : (cache[key] = wL.querySelector(`[data-a="${key}"]`));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: (r.left + r.width * fx - 960) / z + cx, y: (r.top + r.height * fy - 540) / z + cy, w: r.width / z, h: r.height / z };
  };

  // 圆形遮罩：圆心 = 「开始创作」按钮中心（从 DOM 量）
  if (F.overlay && F.wipe) {
    const p = A('start', .5, .5);
    if (p) {
      const sx = (p.x - cx) * z + 960, sy = (p.y - cy) * z + 540;
      wO.style.clipPath = `circle(${F.wipe.r * z}px at ${sx}px ${sy}px)`;
    }
  }
  // 光标（可沿二次贝塞尔从 from 移到锚点）
  let sp = '';
  if (F.cursor) {
    const p = A(F.cursor.anchor, .5, .5);
    if (p) {
      let x = p.x + (F.cursor.dx || 0), y = p.y + (F.cursor.dy || 0);
      if (F.cursor.from) {
        const k = F.cursor.p ?? 1, [x0, y0] = F.cursor.from;
        const mx = x0 + (x - x0) * 0.45, my = Math.min(y0, y) - 140, q = 1 - k;
        x = q * q * x0 + 2 * q * k * mx + k * k * x;
        y = q * q * y0 + 2 * q * k * my + k * k * y;
      }
      sp += cursorSvg(x, y, 1.6 / z);
    }
  }
  spr.innerHTML = sp;
  hud(F, t);
}
const cursorSvg = (x, y, s) => `<svg style="position:absolute;left:${x - 2 * s}px;top:${y - 2 * s}px;filter:drop-shadow(0 ${2 * s}px ${3 * s}px rgba(0,0,0,.45))" width="${22 * s}" height="${30 * s}" viewBox="0 0 22 30"><path d="M2 2 L2 24 L7.5 18.5 L11 27 L15 25.2 L11.6 17 L19 17 Z" fill="#000" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

function hud(F, t) {
  const H = F.hud; let h = '';
  if (H.chap) h += `<div class="chap"><b>${H.chap.no}</b>${H.chap.nm}</div>`;
  if (H.ramp) h += `<div class="ramp">${H.ramp.blink ? '▶▶' : '▷▷'} 4×</div>`;
  if (H.keys) h += `<div class="keys">${H.keys.keys.map(k => `<i class="${H.keys.dn ? 'dn' : ''}">${k}</i>`).join('')}<span>${H.keys.label}</span></div>`;
  if (H.fade) h += `<div class="fade" style="opacity:${H.fade}"></div>`;
  if (H.cap && !NOSUBS) h += `<div class="cap">${H.cap.text.replace(/\{([^}]*)\}/g, '<em>$1</em>')}</div>`;
  hudEl.innerHTML = h;
}

window.render = render;
window.DUR = Q.has('dur') ? +Q.get('dur') : FM.DUR;
window.SUBS = FM.subs();
await document.fonts.load('16px Inter'); await document.fonts.load('600 20px Inter');
await document.fonts.load('14px Mono'); await document.fonts.load('20px "PingFang SC"').catch(() => { });
render(+(Q.get('t') || 0));
window.READY = true;
