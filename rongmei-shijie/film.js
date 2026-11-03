// 51 s：主页 → 开始创作 → 影视工作流 → 点 Mambo（对话、官方技能）→ 无限画布 → 画布 → 生成图/视频 → 放大看视频
import * as UI from './ui.js';

export const DUR = 51;
export const CH = [
  { t: 0.0, no: '01', nm: '主页' },
  { t: 8.6, no: '02', nm: '影视工作流' },
  { t: 22.6, no: '03', nm: '无限画布' },
  { t: 40.6, no: '04', nm: '成片' },
];
const CAPS = [
  [1.0, 5.0, '一站式 {AI 内容创作引擎}'],
  [8.8, 12.4, '点「开始创作」，进入{影视工作流}'],
  [13.2, 16.4, '右下角的 Mambo，是{智能助手}'],
  [17.0, 20.6, '官方技能，一句话就能用'],
  [21.0, 23.0, '装好技能，开始创作'],
  [23.6, 27.0, '无限画布，所有素材{一个画布}'],
  [27.6, 31.0, '节点从无到有'],
  [31.2, 34.4, '点「开始生成图片」'],
  [34.6, 38.0, '图片连起来，{就是分镜}'],
  [38.2, 41.2, '输入提示词，生成视频'],
  [42.4, 47.4, '成片，{就在画布里}'],
  [48.6, 50.8, '融媒视界'],
];
const CAMK = [
  [0.0, 960, 540, 1.00], [3.0, 960, 560, 1.04], [6.0, 960, 596, 1.08], [8.0, 960, 606, 1.10],
  [8.6, 960, 540, 1.02], [9.2, 960, 540, 1.04], [12.4, 960, 540, 1.05], [13.0, 1010, 560, 1.05],
  [14.6, 1040, 560, 1.06], [21.0, 1040, 560, 1.06], [22.4, 960, 540, 1.03], [27.0, 940, 520, 1.14],
  [31.0, 940, 520, 1.22], [35.0, 960, 510, 1.24], [38.0, 960, 510, 1.20], [40.0, 960, 520, 1.18],
  [40.6, 1100, 470, 2.30], [41.2, 960, 540, 1.00], [51.0, 960, 540, 1.00],
];
export function camAt(t) {
  let a = CAMK[0], b = CAMK[CAMK.length - 1];
  for (let i = 0; i < CAMK.length - 1; i++) if (t >= CAMK[i][0] && t <= CAMK[i + 1][0]) { a = CAMK[i]; b = CAMK[i + 1]; }
  const k = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
  const e = k * k * (3 - 2 * k);
  return [a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e, a[3] + (b[3] - a[3]) * e];
}
const lerp = (a, b, k) => a + (b - a) * k;
const E = k => k * k * (3 - 2 * k);
const seg = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const TOP = {
  wf: () => UI.top({ title: 'AI 创作', tags: [{ text: '影视工作流', cls: 'acc' }, { text: '图片生成' }, { text: '视频生成' }], btn: { text: '开始创作', acc: true } }),
  proj: () => UI.top({ title: '我的项目', tags: [{ text: '全部' }, { text: '短剧' }, { text: '宣传片' }], btn: { text: '+ 新建项目', acc: true } }),
  canvas: () => UI.top({ title: '城市之光 · 画布', tags: [{ text: '组镜模式' }, { text: '已保存' }], btn: { text: '导出成片', acc: true } }),
};
export function frame(t) {
  const cam = camAt(t);
  const ch = CH.filter(c => c.t <= t).pop();
  const cap = CAPS.find(c => t >= c[0] && t <= c[1]);
  const hud = { chap: { no: ch.no, nm: ch.nm, op: 1 }, cap: cap ? { text: cap[2], op: 1 } : null,
    fade: Math.max(0, 1 - seg(t, 0.0, 0.7)),
    keys: t >= 7.2 && t <= 8.2 ? { keys: ['⌘', '↵'], label: '开始创作', op: 1, dn: t < 7.6 } : null };

  if (t >= 41.2) {
    const p = seg(t, 41.2, 50.6), sec = Math.min(5, Math.round(p * 5));
    return { screen: UI.videoView({ p: lerp(0, 100, p), t: '00:0' + sec }), full: true, cam, hud, mascot: [], cursor: null };
  }
  if (t >= 27.0) {
    const st = t < 29.6 ? 'empty' : t < 31.2 ? 'prompt' : t < 33.6 ? 'imgbtn' : t < 35.4 ? 'images' : t < 37.6 ? 'wired' : t < 39.4 ? 'videoGen' : 'video';
    return { screen: UI.canvas3Page({ stage: st }), topHtml: '', rail: '',
      winTitle: '融媒视界 · 城市之光 · 无限画布', rt: '◈ 画布设置   ⤓ 导出全部素材   ✦ 585', cam, hud, mascot: [], cursor: null };
  }
  if (t >= 22.6) return { screen: UI.projectsPage({ hot: t >= 26.4 ? 0 : -1 }), topHtml: TOP.proj(), rail: '无限画布',
    winTitle: '融媒视界 · 无限画布 · 我的项目', cam, hud, mascot: [], cursor: null };
  if (t >= 17.6) {
    const used = t >= 21.4 ? 2 : -1;
    return { screen: `<div class="skdrawer">${UI.skillsPage({ used })}</div>`, topHtml: TOP.wf(), rail: 'AI 创作',
      winTitle: '融媒视界 · 技能管理', cam, hud, mascot: [], cursor: null };
  }
  if (t >= 13.0) return { screen: UI.workflowPage({ pet: true, drawer: t >= 14.6 ? 'open' : null }), topHtml: TOP.wf(), rail: 'AI 创作',
    winTitle: '融媒视界 · AI 创作', cam, hud, mascot: [],
    cursor: { anchor: 'pet', dx: -12, dy: -10, op: t >= 14.6 ? .85 : 1 } };
  if (t >= 8.6) return { screen: UI.workflowPage({ t }), topHtml: TOP.wf(), rail: 'AI 创作',
    winTitle: '融媒视界 · AI 创作', cam, hud, mascot: [], cursor: null };
  if (t >= 7.95) return {
    screen: UI.homePage({ t, hover: t > 6.4, press: t > 7.55 && t < 8.05 }), rail: '', winTitle: 'mvaigc.cn — 融媒视界',
    overlay: UI.workflowPage({ t: 8.9 }), overlayRail: 'AI 创作', overlayTop: TOP.wf(), overlayTitle: '融媒视界 · AI 创作',
    wipe: { r: lerp(0, 1450, E(seg(t, 7.95, 8.72))) },
    cam, hud, mascot: [], cursor: null };
  return { screen: UI.homePage({ t, hover: t > 6.4, press: t > 7.55 }), rail: '', winTitle: 'mvaigc.cn — 融媒视界',
    scrollY: lerp(0, 250, E(seg(t, 0.4, 7.8))), cam, hud, mascot: [],
    cursor: { anchor: 'start', from: [1560, 940], p: E(seg(t, 6.0, 7.55)), dx: 6, dy: 12 } };
}
export function subs() { return CAPS.map(([t0, t1, text]) => ({ t0, t1, text: text.replace(/[{}]/g, '') })); }
