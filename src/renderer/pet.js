'use strict';

/**
 * 渲染层：用 image/ 素材（已抠底）逐管渲染 8 位辉光管。
 * 只负责画画面、跑动画、把点击/拖拽意图交给主进程；状态以主进程为准。
 */

const TUBE_COUNT = 8;
const SEP_WORLDLINE = [1]; // 第 2 位是小数点
const SEP_TIME = [2, 5]; // HH:MM:SS 的两个冒号

const ASSETS = '../assets';
/** 数字 → 管体素材；空格表示"这支管没点亮"，用 empty.png */
const tubeSrc = (glyph) => (/^[0-9]$/.test(glyph) ? `${ASSETS}/tubes/${glyph}.png` : `${ASSETS}/tubes/empty.png`);
const DOT_SRC = `${ASSETS}/dot.png`;

const el = {};
let cfg = null;
let state = null;
let brand = 'AMADEUS';
let statusText = { time: '观测链路稳定', worldline: '收束范围监测' };
let animToken = 0;
let busy = false;
let pointerActive = false;
let clockTimer = null;
let noticeTimer = null;
let lastClockKey = '';
let slots = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ 构建 */

function buildRack() {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < TUBE_COUNT; i += 1) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.index = String(i);

    const tube = document.createElement('img');
    tube.className = 'tube-img';
    tube.alt = '';
    tube.draggable = false;
    tube.src = tubeSrc(' ');

    const upper = document.createElement('img');
    upper.className = 'sep-dot upper';
    upper.src = DOT_SRC;
    upper.alt = '';
    upper.draggable = false;

    const lower = document.createElement('img');
    lower.className = 'sep-dot lower';
    lower.src = DOT_SRC;
    lower.alt = '';
    lower.draggable = false;

    slot.append(tube, upper, lower);
    frag.append(slot);
    slots.push(slot);
  }
  el.rack.append(frag);
}

/** 预加载全部管体，避免切换数字时出现空帧 */
function preloadAssets() {
  for (const g of '0123456789 ') {
    const img = new Image();
    img.src = tubeSrc(g);
  }
  const dot = new Image();
  dot.src = DOT_SRC;
}

/* ------------------------------------------------------------ 字形与渲染 */

function glyphsForMicro(micro) {
  // 必须与 src/worldline.js 的 formatMicro 保持一致：
  // 负向变动率（菲利斯线 -0.275349）不显示负号，按幅值显示。
  const m = Math.min(2999999, Math.abs(Math.round(Number(micro) || 0)));
  const unit = Math.floor(m / 1000000);
  const frac = m % 1000000;
  return `${unit}.${String(frac).padStart(6, '0')}`.split('');
}

function clockGlyphs(date) {
  const p2 = (n) => String(n).padStart(2, '0');
  const h = cfg?.time?.twentyFourHour === false ? date.getHours() % 12 || 12 : date.getHours();
  return `${p2(h)}:${p2(date.getMinutes())}:${p2(date.getSeconds())}`.split('');
}

/**
 * @param glyphs  8 个字符（分隔符原样保留，' ' 表示该管熄灭）
 * @param opts.sep      分隔符所在的管位下标
 * @param opts.sepDots  分隔符用几个点：小数点 1 个，冒号 2 个
 */
function applyGlyphs(glyphs, opts = {}) {
  const sep = opts.sep || [];
  const sepDots = opts.sepDots || 1;
  const animate = opts.animate !== false;

  for (let i = 0; i < TUBE_COUNT; i += 1) {
    const slot = slots[i];
    if (!slot) continue;
    const isSep = sep.includes(i);
    slot.classList.toggle('is-sep', isSep);

    if (isSep) {
      slot.dataset.dots = String(sepDots);
      slot.dataset.glyph = '';
      // 分隔符管位也是一支真实的管：换成"未点亮"的管体，再把光点叠在上面
      const sepImg = slot.querySelector('.tube-img');
      if (sepImg.dataset.glyph !== ' ') {
        sepImg.src = tubeSrc(' ');
        sepImg.dataset.glyph = ' ';
      }
      continue;
    }

    const glyph = glyphs[i] ?? ' ';
    slot.dataset.glyph = glyph === ' ' ? '' : glyph;
    const img = slot.querySelector('.tube-img');
    const changed = img.dataset.glyph !== glyph;
    if (changed) {
      img.src = tubeSrc(glyph);
      img.dataset.glyph = glyph;
      if (animate) {
        slot.classList.remove('settle');
        void slot.offsetWidth; // 强制重排，让动画能连续重放
        slot.classList.add('settle');
      }
    }
  }

  el.pet.dataset.display = glyphs.join('');
}

function scrambleGlyphs() {
  const out = [];
  for (let i = 0; i < TUBE_COUNT; i += 1) {
    if (i === 1) {
      out.push('.');
    } else if (i === 0) {
      out.push(String(Math.floor(Math.random() * 3))); // 0–2
    } else if (Math.random() < 0.12) {
      out.push(' '); // 偶尔整支管熄灭，像真实辉光管换字时的瞬间
    } else {
      out.push(String(Math.floor(Math.random() * 10)));
    }
  }
  return out;
}

/* -------------------------------------------------------------- 时间模式 */

function renderClock(animate) {
  const now = new Date();
  const glyphs = clockGlyphs(now);
  const key = glyphs.join('');
  if (key === lastClockKey && !animate) return;
  lastClockKey = key;
  applyGlyphs(glyphs, { sep: SEP_TIME, sepDots: 2, animate: Boolean(animate) });
  // 状态条上的日期跨天时也要跟着变
  refreshIdleFoot();
}

/**
 * 对齐到整秒边界再触发下一次刷新：每秒只重算一次，误差不累积，
 * 因此不会出现跳秒或逐渐漂移。
 */
function scheduleClock() {
  clearTimeout(clockTimer);
  const now = Date.now();
  const delay = 1000 - (now % 1000) + 8;
  clockTimer = setTimeout(() => {
    if (!state || state.mode !== 'time') return;
    renderClock(true);
    scheduleClock();
  }, delay);
}

function startClock() {
  lastClockKey = '';
  renderClock(false);
  scheduleClock();
}

function stopClock(clear) {
  clearTimeout(clockTimer);
  clockTimer = null;
  if (clear) lastClockKey = '';
}

/* ---------------------------------------------------------- 世界线模式 */

function updateRange(range) {
  if (!range) return;
  el.rangeLabel.textContent = range;
}

function formatDate(date) {
  const p2 = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`;
}

/**
 * 底部状态条有一个"常驻内容"：时间模式显示日期，世界线模式显示 Δ 待测。
 * 临时提示（点击回声、特殊值名称）会覆盖它，提示结束后自动恢复。
 */
let noticeHold = false;

function idleFootText() {
  if (!state) return '';
  return state.mode === 'time' ? formatDate(new Date()) : 'Δ 待测';
}

function penetrationHint() {
  const hotkey = cfg?.window?.toggleClickThroughHotkey || 'Control+Alt+Shift+D';
  return `点击穿透中 · ${hotkey} 或托盘图标可恢复`;
}

function refreshIdleFoot() {
  if (noticeHold) return;
  el.notice.textContent = idleFootText();
  el.notice.classList.remove('special');
  el.pet.classList.remove('special-active');

  // 穿透开启时，第二行常驻显示"怎么退出去"。
  // 这是唯一不需要任何交互就能看到的提示——托盘图标可能被 Windows 收进溢出区，
  // 全局快捷键也可能被用户忘掉。
  const penetrating = Boolean(state && state.clickThrough);
  if (el.hint) {
    el.hint.textContent = penetrating ? penetrationHint() : '';
    el.hint.classList.toggle('special', penetrating);
  }
  if (el.hudChapter) {
    el.hudChapter.textContent = '';
    el.hudChapter.classList.remove('visible');
  }
}

function showNotice(text, opts = {}) {
  clearTimeout(noticeTimer);
  noticeHold = true;
  el.notice.textContent = text;
  const special = Boolean(opts.special);
  el.notice.classList.toggle('special', special);
  el.pet.classList.toggle('special-active', special);

  // 第二行：穿透提示优先（安全信息不能被普通提示顶掉），
  // 其次是特殊世界线的台词，最后留空。
  if (el.hint) {
    const penetrating = Boolean(state && state.clickThrough);
    const line = penetrating ? penetrationHint() : opts.quote || '';
    el.hint.textContent = line;
    el.hint.classList.toggle('special', Boolean(line));
  }

  // 顶部 DIVERGENCE 旁：该世界线的章节 / 出处
  if (el.hudChapter) {
    el.hudChapter.textContent = opts.chapter || '';
    el.hudChapter.classList.toggle('visible', Boolean(opts.chapter));
  }

  const hold = Number(opts.hold ?? 2200);
  if (hold > 0) {
    noticeTimer = setTimeout(() => {
      noticeHold = false;
      refreshIdleFoot();
    }, hold);
  }
}

function clearNotice() {
  clearTimeout(noticeTimer);
  noticeTimer = null;
  noticeHold = false;
  refreshIdleFoot();
}

function flash() {
  el.pet.classList.remove('flash');
  void el.pet.offsetWidth;
  el.pet.classList.add('flash');
  setTimeout(() => el.pet.classList.remove('flash'), 320);
}

/**
 * 特殊世界线：先急速闪烁跳动，再落定到目标值，模拟世界重构。
 */
async function playSpecial(result) {
  const token = ++animToken;
  busy = true;
  const duration = Math.max(200, Number(cfg?.interaction?.specialAnimationMs) || 820);
  el.pet.classList.add('surge');
  const started = performance.now();

  try {
    while (performance.now() - started < duration) {
      if (token !== animToken) return;
      applyGlyphs(scrambleGlyphs(), { sep: SEP_WORLDLINE, sepDots: 1, animate: false });
      await sleep(38 + Math.random() * 34);
    }
    if (token !== animToken) return;
    el.pet.classList.remove('surge');
    applyGlyphs(glyphsForMicro(result.micro), { sep: SEP_WORLDLINE, sepDots: 1, animate: true });
    updateRange(result.range);
    flash();
    const info = result.special || {};
    showNotice(info.label || '世界线偏移', {
      special: true,
      quote: info.quote || '',
      chapter: info.chapter || '',
      hold: Number(cfg?.interaction?.specialLabelHoldMs) || 6000,
    });
  } finally {
    busy = false;
    el.pet.classList.remove('surge');
  }
}

/* ---------------------------------------------------------------- 动作 */

function deltaText(delta) {
  const sign = delta >= 0 ? '+' : '-';
  return `Δ ${sign}${(Math.abs(delta) / 1000000).toFixed(6)}`;
}

/**
 * 串行化的点击队列：无论用户点多快，一次点击一定对应一次数值变化——
 * 不会因为两次点击的 IPC 返回顺序错乱而"吞掉"其中一次，
 * 特殊值的世界重构动画播放期间也不会把点击丢掉，而是排队等动画结束。
 */
let queuedClicks = 0;
let draining = false;

function enqueueClick() {
  if (!state) return;
  queuedClicks = Math.min(queuedClicks + 1, 16);
  if (draining) return;
  drainClicks();
}

async function drainClicks() {
  draining = true;
  try {
    while (queuedClicks > 0) {
      queuedClicks -= 1;
      await performClick();
    }
  } finally {
    draining = false;
  }
}

async function performClick() {
  if (!state) return;

  if (state.mode === 'time') {
    // 时间模式下单击不改动时间，只给一行克制的状态回声
    showNotice('时间坐标已锁定', { hold: 1800 });
    return;
  }

  const result = await window.dsh.click();
  if (!result || result.kind !== 'worldline') return;

  if (result.special) {
    await playSpecial(result);
    return;
  }

  applyGlyphs(glyphsForMicro(result.micro), { sep: SEP_WORLDLINE, sepDots: 1, animate: true });
  updateRange(result.range);
  showNotice(deltaText(result.delta), { hold: 1600 });
}

/* ------------------------------------------------------------ 模式切换 */

function renderMode(animate) {
  if (!state) return;
  const isTime = state.mode === 'time';
  el.pet.dataset.mode = state.mode;
  el.hudLabel.textContent = isTime ? 'LOCAL TIME' : 'DIVERGENCE';

  if (isTime) {
    el.hudStatus.textContent = `${brand} · ${statusText.time}`;
    clearNotice();
    startClock();
  } else {
    el.hudStatus.textContent = `${brand} · ${statusText.worldline}`;
    stopClock(true);
    clearNotice();
    applyGlyphs(glyphsForMicro(state.worldline.micro), {
      sep: SEP_WORLDLINE,
      sepDots: 1,
      animate: Boolean(animate),
    });
    updateRange(state.worldline.range);
  }
}

/* -------------------------------------------------------------- 尺寸回报 */

async function reportSize() {
  const rect = el.pet.getBoundingClientRect();
  await window.dsh.reportSize({ w: Math.ceil(rect.width), h: Math.ceil(rect.height) });
}

/* ------------------------------------------------------------------ 初始化 */

function applyAppearance() {
  const look = cfg.appearance || {};
  // 背景是"运行时可切换"的状态（右键菜单/托盘），必须优先读 state，
  // 否则用配置里的默认值会把切换结果盖掉（亚克力材质就会被深色板挡住）。
  const background = (state && state.background) || look.background || 'none';
  el.pet.classList.toggle('background-none', background === 'none');
  el.pet.classList.toggle('background-dark', background === 'dark');
  el.pet.classList.toggle('background-fond', background === 'fond');
  el.pet.classList.toggle('background-acrylic', background === 'acrylic');
  el.pet.classList.toggle('background-frosted', background === 'frosted');
  el.pet.classList.toggle('no-scan', !look.scanlines);
  if (look.showHeader === false) el.hudLabel.style.display = 'none';
}

function applyAssetsMode(mode) {
  // 素材模式由主进程判定：有 tubes 图就盖图，没有就用 CSS 画的数码管
  const m = mode === 'image' ? 'image' : 'css';
  if (document.body.dataset.assets !== m) document.body.dataset.assets = m;
}

async function boot() {  el.pet = document.getElementById('pet');
  el.rack = document.getElementById('rack');
  el.hudLabel = document.getElementById('hudLabel');
  el.hudChapter = document.getElementById('hudChapter');
  el.hudStatus = document.getElementById('hudStatus');
  el.rangeLabel = document.getElementById('rangeLabel');
  el.notice = document.getElementById('notice');
  el.hint = document.getElementById('hint');

  buildRack();
  preloadAssets();

  const initial = await window.dsh.bootstrap();
  cfg = initial.config;
  state = initial.state;
  applyAssetsMode(state.assetsMode);
  if (initial.texts) {
    if (initial.texts.brand) brand = initial.texts.brand;
    if (initial.texts.status) statusText = { ...statusText, ...initial.texts.status };
  }

  applyAppearance();
  renderMode(false);

  // 先量尺寸再显示，避免窗口先以错误大小闪一下
  await reportSize();
  await document.fonts.ready.catch(() => {});
  await reportSize();
  setTimeout(reportSize, 400);
  setTimeout(reportSize, 1200);

  window.dsh.onState((next) => {
    if (!next) return;
    const modeChanged = !state || state.mode !== next.mode;
    const backgroundChanged = !state || state.background !== next.background;
    const clickThroughChanged = !state || state.clickThrough !== next.clickThrough;
    state = next;
    applyAssetsMode(next.assetsMode);
    // 背景材质可能被菜单/托盘改掉：重挂样式类（亚克力还要靠主进程重建窗口）
    if (backgroundChanged) applyAppearance();
    // 穿透状态变了：刷新第二行的"怎么恢复"提示
    if (clickThroughChanged) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
      noticeHold = false;
      refreshIdleFoot();
    }
    if (modeChanged) {
      animToken += 1; // 打断尚未结束的特殊动画
      busy = false;
      renderMode(true);
    } else if (next.mode === 'worldline' && !busy) {
      updateRange(next.worldline?.range);
    }
  });

  window.dsh.onPulse(({ message }) => {
    if (message) showNotice(message, { hold: 2600 });
  });
}

/* -------------------------------------------------------------------- 输入 */

function bindInput() {
  const pet = document.getElementById('pet');

  pet.addEventListener('mousedown', async (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    pointerActive = true;
    pet.classList.add('dragging');
    await window.dsh.pointerDown();
  });

  // 拖拽期间窗口跟着光标走，鼠标抬起可能落在窗口外，因此在 window 上监听
  window.addEventListener('mouseup', async (event) => {
    if (event.button !== 0 || !pointerActive) return;
    pointerActive = false;
    pet.classList.remove('dragging');
    const result = await window.dsh.pointerUp();
    if (result && result.dragged) return; // 拖拽绝不触发变动率
    enqueueClick();
  });

  window.addEventListener('blur', async () => {
    if (!pointerActive) return;
    pointerActive = false;
    pet.classList.remove('dragging');
    await window.dsh.pointerUp();
  });

  pet.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    window.dsh.openMenu();
  });

  document.addEventListener('dragstart', (event) => event.preventDefault());
}

boot().catch((err) => {
  document.body.textContent = `启动失败：${err.message}`;
});

bindInput();
