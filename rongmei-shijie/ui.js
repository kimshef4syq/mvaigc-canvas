// 融媒视界 UI kit — 按用户截图重绘（mvaigc.cn）。所有界面由代码绘制，不用截图。
const THUMBS = [
  'linear-gradient(160deg,#1B1030 0%,#3A2160 45%,#8B5CF6 100%)',
  'linear-gradient(150deg,#2A1A38 0%,#6B3FA0 55%,#C9A6FF 100%)',
  'linear-gradient(165deg,#12122A 0%,#2E2A6B 55%,#7C8BE8 100%)',
  'linear-gradient(155deg,#241B14 0%,#6E4A2C 55%,#D9B27A 100%)',
  'linear-gradient(150deg,#0E2A2E 0%,#2C6B66 55%,#BFD9A6 100%)',
  'linear-gradient(160deg,#301E2A 0%,#8C4A55 55%,#E8C08A 100%)',
  'linear-gradient(170deg,#1A2340 0%,#3E5C8C 45%,#C98A5A 100%)',
  'linear-gradient(150deg,#1A1030 0%,#4A2A80 55%,#B98AE8 100%)',
];
export const thumb = (i) => THUMBS[i % THUMBS.length];
const RAIL = [['首页', '◈'], ['我的项目', '▦'], ['无限画布', '⧉'], ['AI 创作', '✦'], ['资产', '◇']];

export function rail(active) {
  return `<div class="rail"><div class="logo"><b></b><b></b></div>
    ${RAIL.map(([n, ic]) => `<div class="item ${n === active ? 'on' : ''}"><div class="ic">${ic}</div>${n}</div>`).join('')}
    <div class="bot"><div class="item"><div class="ic">?</div>新手指引</div></div></div>`;
}
export function top(o) {
  return `<div class="top"><div class="h1">${o.title}</div>${o.crumb ? `<div class="crumb">${o.crumb}</div>` : ''}<div class="sp"></div>
    ${(o.tags || []).map(t => `<div class="tag ${t.cls || ''}">${t.text}</div>`).join('')}
    ${o.btn ? `<div class="btn ${o.btn.acc ? 'acc' : ''}" data-a="${o.btn.key || ''}">${o.btn.text}</div>` : ''}</div>`;
}
export function win(o) {
  return `<div class="win" style="left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px">
    <div class="tbar"><div class="lights"><i></i><i></i><i></i></div><div class="ttl">${o.title || '融媒视界'}</div><div class="rt">${o.rt || ''}</div></div>
    <div class="app">${o.rail || ''}<div class="content">${o.top || ''}<div class="body">${o.body || ''}</div></div></div></div>`;
}
export function desk(o = {}) {
  return `<div id="wall"></div><div id="menubar"><b>融媒视界</b><span>文件</span><span>编辑</span><span>视图</span><span>窗口</span><span>帮助</span>
    <div class="r"><span>${o.clock || '22:14'}</span><span>100%</span><span>⌘</span></div></div>`;
}

/* ---------- 主页 ---------- */
const QUICK = [['✦', '海报制作', '一键生成精美海报'], ['▣', '视频生成', 'AI 智能生成视频'], ['◫', '宣传片', '专业级宣传片制作'],
['☺', '数字人主播', '数字人智能播报'], ['♪', 'AI 音频制作', 'AI 生成原创音乐'], ['⌘', '工作流', '自定义创作流程'],
['⌫', '视频擦除', '智能去除视频元素'], ['⤢', '视频超分', '提升视频清晰度']];
const WORKS = [[0], [3], [2], [5], [6]];
const S = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const E = k => k * k * (3 - 2 * k);
const st = (o) => `opacity:${o.op ?? 1};transform:${o.tf || 'none'}`;

export function homePage(o = {}) {
  const t = o.t ?? 0;
  const panels = (flip) => Array.from({ length: 6 }, (_, i) => {
    const col = i % 2, row = (i / 2) | 0, e = E(S(t, 0.6 + i * 0.12, 1.5 + i * 0.12));
    return `<div class="pane" style="left:${flip ? 'auto' : col * 150 + 'px'};right:${flip ? col * 150 + 'px' : 'auto'};top:${row * 168}px;
      transform:rotateY(${flip ? -26 : 26}deg) translateZ(${-col * 26}px);opacity:${0.3 + 0.65 * e}"><div class="in" style="background:${thumb(i + (flip ? 3 : 0))}"><i></i></div></div>`;
  }).join('');
  const streaks = Array.from({ length: 9 }, (_, i) => {
    const y = 240 + i * 46, w = 420 + (i % 3) * 180, rot = -14 + (i % 5) * 7;
    return `<i style="left:${18 + (i % 4) * 20}%;top:${y}px;width:${w}px;transform:rotate(${rot}deg);opacity:${(0.15 + (i % 3) * 0.1) * E(S(t, 0.8, 2.0))}"></i>`;
  }).join('');
  const eT = E(S(t, 1.0, 2.2)), eM = E(S(t, 1.3, 2.5)), eL = E(S(t, 2.2, 3.4)), eW = E(S(t, 5.6, 6.8));
  const press = o.press ? 0.96 : 1, hov = o.hover ? 1 : 0;
  const pulse = 1 + 0.03 * Math.sin(t * 2.4);
  return `<div class="homewrap"><div class="home">
    <div class="glow g1"></div><div class="glow g2"></div><div class="streaks">${streaks}</div>
    <div class="tags" style="${st({ op: eT, tf: `translateY(${14 * (1 - eT)}px)` })}"><span>AI 驱动创意</span><span>数据赋能决策</span><span>内容连接价值</span></div>
    <div class="wall">${panels(false)}${panels(true)}</div>
    <div class="mark" style="${st({ op: eM, tf: `scale(${0.9 + 0.1 * eM})` })}"><img src="assets/logo.svg" alt=""><div class="nm">融媒视界</div><div class="en">MEDIA VISION</div></div>
    <div class="orb" style="transform:translate(-50%,-50%) scale(${pulse})">AI</div>
    <div class="cta" data-a="start" style="transform:translateX(-50%) scale(${press});box-shadow:0 ${16 + 18 * hov}px ${44 + 20 * hov}px rgba(151,71,255,${0.45 + 0.2 * hov}),inset 0 0 0 1px rgba(255,255,255,${0.3 + 0.25 * hov})">✦ 开始创作</div>
    <div class="slogan" style="${st({ op: eL, tf: `translateY(${12 * (1 - eL)}px)` })}">让创意被看见　让价值被连接</div>
    <div class="quick">${QUICK.map(([ic, nm, sub], i) => { const e = E(S(t, 4.2 + i * 0.1, 4.9 + i * 0.1)); return `<div class="q" style="${st({ op: e, tf: `translateY(${22 * (1 - e)}px)` })}"><div class="ic">${ic}</div><div class="nm">${nm}</div><div class="sub">${sub}</div></div>`; }).join('')}</div>
    <div class="works" style="${st({ op: eW, tf: `translateY(${16 * (1 - eW)}px)` })}">${WORKS.map(([ti]) => `<div class="w" style="background:${thumb(ti)}"><span class="lab">视频</span></div>`).join('')}</div>
  </div></div>`;
}

/* ---------- 影视工作流（AI 创作页） ---------- */
const FEATS = [['无限画布', '节点式无限画布，自由编排图文与视频创作', 0], ['配音工作台', 'AI 智能配音与声音创作，让每一句表达更具感染力', 1, true],
['视频处理', '支持视频擦除与视频超分，一站式优化素材质量', 2], ['音乐创作', '为你的佳作配乐，让每一帧都更有感染力', 3],
['图片生成', '视觉创作与智能图像编辑，精准实现创意', 4], ['视频生成', '聚合顶尖模型为专业视频制作提供方案', 5]];
export function workflowPage(o = {}) {
  const t = o.t ?? 0, eH = E(S(t, 7.92, 8.5));
  return `<div class="wf">
    <div class="hero" style="${st({ op: eH, tf: `scale(${0.965 + 0.035 * eH})` })}">
      <div class="bdg"><b>影视工作流</b><span>剧本拆解 2.0</span></div>
      <div class="s">从剧本到分镜的 AI 创作引擎，全程可控可编辑</div>
      <div class="cta"><div class="btn acc" data-a="start2">✦ 开始创作</div></div>
      <div class="art"></div>
    </div>
    <div class="feats">${FEATS.map(([tt, ss, ti, isNew], i) => {
      const e = E(S(t, 7.98 + i * 0.08, 8.58 + i * 0.08));
      return `<div class="feat" style="${st({ op: e, tf: `translateY(${26 * (1 - e)}px)` })}"><div class="t">${tt}${isNew ? '<span class="new">New</span>' : ''}</div><div class="s">${ss}</div>
      <div class="art" style="background:radial-gradient(140px 100px at 60% 50%,rgba(207,170,255,.35),transparent 72%),linear-gradient(140deg,${'#1B1030'},${'#4A2A80'})"><i style="background:${thumb(ti)};opacity:.55"></i></div></div>`;
    }).join('')}</div>
    ${o.pet ? petOrb() : ''}${o.drawer ? mamboDrawer() : ''}
  </div>`;
}

/* ---------- 我的项目 / 无限画布列表 ---------- */
const PROJ = [['未命名', '编辑于 33 分钟前 · 创建人 syq-test', 0], ['hhaha', '编辑于 4 小时前 · 创建人 syq-test', 1],
['未命名', '编辑于 4 小时前 · 创建人 syq-test', 2], ['未命名', '编辑于 4 小时前 · 创建人 syq-test', 3],
['未命名', '编辑于 4 小时前 · 创建人 syq-test', 4], ['未命名', '编辑于 4 小时前 · 创建人 syq-test', 5],
['test902', '编辑于 4 小时前 · 创建人 syq-test', 6], ['worker-snake', '编辑于 4 小时前 · 创建人 syq-test', 7],
['bumen录音', '编辑于 4 小时前 · 创建人 syq-test', 0], ['未命名', '编辑于 4 小时前 · 创建人 syq-test', 1],
['防灾', '编辑于 4 小时前 · 创建人 syq-test', 2]];
export function projectsPage(o = {}) {
  const n = o.shown || 11;
  return `<div class="proj">
    <div class="tabs"><span class="on">syq-test的工作空间</span><span>团队空间</span></div>
    <div class="pg2">
      <div class="pc2 new" data-a="newproj"><div class="plus">+</div><span>创建项目</span></div>
      ${PROJ.slice(0, n).map(([nm, sub, ti], i) => `<div class="pc2 ${o.hot === i ? 'hot' : ''}" style="${o.hot === i ? 'border-color:#8B5CF6;box-shadow:0 0 0 2px rgba(151,71,255,.35)' : ''}">
        <div class="th" style="background:${thumb(ti)}"><div class="ic">⤢</div></div>
        <div class="mt"><div class="nm">${nm} <i>✎</i></div><div class="sub">${sub}</div></div></div>`).join('')}
    </div></div>`;
}

/* ---------- 无限画布 ---------- */
export function canvas3Page(o = {}) {
  const st = o.stage || 'empty';
  const N = [];
  if (st !== 'empty') N.push(`<div class="n on" style="left:60px;top:40px;width:330px" data-a="n0">
    <div class="hd"><span class="ico">▦</span>生图节点<span class="sz">2560 × 1440</span></div>
    <div class="nb"><div style="height:180px;background:${thumb(0)}"></div><div class="chip">快速 ⌄</div><div class="cnt">2 张 ⌄</div></div></div>`);
  if (st === 'imgbtn') N.push(`<div class="n" style="left:60px;top:290px;width:330px" data-a="nbtn">
    <div class="hd"><span class="ico">▦</span>生图节点<span class="sz">2560 × 1440</span></div>
    <div class="nb" style="padding:12px"><div style="height:52px;border-radius:10px;background:linear-gradient(140deg,#9747FF,#6A2BC9);display:grid;place-items:center;color:#fff;font-size:13px;font-weight:650" data-a="startimg">开始生成图片</div></div></div>`);
  if (st === 'images' || st === 'wired' || st === 'video' || st === 'videoGen') {
    N.push(`<div class="n" style="left:470px;top:150px;width:210px" data-a="i1"><div class="hd"><span class="ico">▦</span>生图节点<span class="sz">2560 × 1440</span></div>
      <div class="nb"><div style="height:150px;background:${thumb(1)}"></div><div class="chip">快速 ⌄</div><div class="cnt">3 个版本 ⌄</div></div></div>`);
    N.push(`<div class="n" style="left:720px;top:290px;width:160px" data-a="i2"><div class="hd"><span class="ico">▦</span>图片节点<span class="sz">700 × 872</span></div>
      <div class="nb"><div style="height:170px;background:${thumb(2)}"></div></div></div>`);
    N.push(`<div class="n" style="left:940px;top:290px;width:260px" data-a="i3"><div class="hd"><span class="ico">◎</span>720 全景图<span class="sz">2048 × 1024</span></div>
      <div class="nb"><div style="height:130px;background:${thumb(4)}"></div></div></div>`);
  }
  if (st === 'video' || st === 'videoGen') N.push(`<div class="n ${st === 'video' ? 'on' : ''}" style="left:60px;top:520px;width:430px" data-a="nv">
    <div class="hd"><span class="ico">▶</span>生视频节点<span class="sz">1280 × 720</span></div>
    <div class="nb"><div style="height:200px;background:${thumb(6)}"></div><div class="pbar"><span>▶</span><span>00:00.0</span><div class="tl"><i></i></div><span>${st === 'videoGen' ? '生成中…' : '00:30.1'}</span><span>⤢</span><span>⤓</span></div></div></div>`);
  const wire = (x1, y1, x2, y2) => `<path d="M${x1} ${y1} C${x1 + 90} ${y1}, ${x2 - 90} ${y2}, ${x2} ${y2}" stroke="#3E3B52" stroke-width="1.4" fill="none"/>`;
  const wires = (st === 'wired' || st === 'video' || st === 'videoGen')
    ? `<svg class="wires">${wire(390, 130, 470, 240)}${wire(390, 130, 720, 380)}${wire(680, 240, 940, 380)}${wire(880, 380, 60, 560)}</svg>` : '';
  return `<div class="cv3" data-a="cv">
    <div class="tool"><div class="b">◈ 画布设置</div><div class="b">⤓ 导出全部素材</div><div class="b cr">✦ 585</div></div>
    ${wires}${N.join('')}</div>`;
}

/* ---------- Mambo 小宠物 + 对话 ---------- */
export function petOrb(o = {}) {
  return `<div class="pet" data-a="pet"><div class="halo"></div><div class="bd"><span class="eye l"></span><span class="eye r"></span><span class="mo"></span></div></div>`;
}
export function mamboDrawer(o = {}) {
  return `<div class="mb" data-a="drawer">
    <div class="mh"><span class="dot"></span>Mambo<span class="sp"></span><div class="ic"><span>◎</span><span>▤</span></div></div>
    <div class="mbd">
      <div class="orb"></div>
      <div class="hi">你好 <b>syq-test</b></div>
      <div class="guess">猜你想做：</div>
      <div class="chips">${['图片生成', '生成视频', 'AI配乐', '配音', '视频处理', '我的项目'].map(t => `<span>${t}</span>`).join('')}</div>
    </div>
    <div class="mfoot">
      <div class="row"><span>🔔</span><span>⚙</span></div>
      <div class="box"><div class="ph">问问 Mambo，或输入 /使用技能</div><div class="r"><span class="clip">📎</span><span class="send">发送 <b>↑</b></span></div></div>
    </div>
  </div>`;
}

/* ---------- 技能管理 ---------- */
const OFFICIAL = [
  ['剧本灵感', '用访谈把模糊想法收成创意 brief 和迷你分场，写在当前对话里。本技能只定方向，不写完整分场剧本。'],
  ['写剧本', '把用户的想法或有 brief 写成角色清单与分场剧本，写在当前对话里。有想法即可写，不必先做访谈式收集。'],
  ['编剧大师', '全格式影视编剧技能。覆盖从 1-3 分钟概念超短片到 90 分钟电影长片，多集剧集的全格式剧本创作。'],
  ['美术设计', '根据用户在对话里提供的剧情、角色或场景，输出人物、场景、道具设定与文生图提示词。'],
];
export function skillsPage(o = {}) {
  const used = o.used ?? -1;
  return `<div class="skm">
    <div class="h">‹ 技能管理<span class="sp"></span><span class="ic">▥</span></div>
    <div class="tabs"><span>我的技能</span><span class="on">官方技能</span></div>
    <div class="search">搜索技能</div>
    <div class="note">平台官方 Skill，仅支持查看和使用。</div>
    <div class="list">${OFFICIAL.map(([nm, ds], i) => `<div class="card"><div class="nm">${nm}<span class="tag">官方</span></div>
      <div class="ds">${ds}</div><div class="au">创建者：ManyAni · 官方</div>
      <div class="row"><b class="${used === i ? 'on' : ''}" data-a="use${i}">${used === i ? '已启用' : '使用'}</b><b>查看</b></div></div>`).join('')}</div>
  </div>`;
}

/* ---------- 视频特写 ---------- */
export function videoView(o = {}) {
  const CITY = [[0, 150, 120], [130, 90, 150], [230, 60, 190], [300, 120, 130], [430, 80, 165], [520, 55, 210], [585, 130, 140], [730, 70, 180], [810, 110, 155], [930, 60, 200], [1000, 130, 135], [1140, 75, 170], [1220, 120, 145], [1350, 65, 185], [1430, 140, 120]];
  const CCOL = ['#141828', '#1B2138', '#0F1322', '#181C30', '#12162A'];
  return `<div class="vzoom">
    <div class="film"><div class="sky"></div><div class="sun"></div>
      <div class="city">${CITY.map(([l, w, h], idx) => `<i style="left:${l}px;width:${w}px;height:${h}px;background:${CCOL[idx % CCOL.length]}"></i>`).join('')}</div>
      <div class="fog"></div><div class="vign"></div></div>
    <div class="badge">✦ 生视频节点 · 5s · 1080p</div>
    <div class="bar"><div class="pl">▶</div><div class="tl"><i style="width:${o.p ?? 60}%"></i></div><div class="tm">${o.t || '00:03'} / 00:05</div></div>
  </div>`;
}
