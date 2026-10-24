'use strict';

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, globalShortcut, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const store = require('./store');
const worldline = require('./worldline');
const texts = require('./texts');
const { createIcon, describeIcon } = require('./icon');

const ROOT = path.join(__dirname, '..');

/**
 * 数据目录（config / texts / state / logs）。
 * - 开发时（npm start）：就是工程根目录
 * - 打包后（resources\app）：放在 exe 同目录，做成绿色版，
 *   否则配置被埋进 resources 里，用户根本改不了
 */
const DATA_ROOT = app.isPackaged ? path.dirname(process.execPath) : ROOT;
const CONFIG_PATH = path.join(DATA_ROOT, 'config.json');
const TEXTS_PATH = path.join(DATA_ROOT, 'texts.json');
const STATE_PATH = path.join(DATA_ROOT, 'state', 'state.json');

/**
 * Electron 是 GUI 子系统程序，控制台输出经常拿不到。
 * 因此启动过程一路写 logs/app.log，出问题时用户直接把日志发过来即可。
 */
const LOG_PATH = path.join(DATA_ROOT, 'logs', 'app.log');
let logStream = null;

function logSync(...args) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${args.join(' ')}\n`);
  } catch {
    /* 日志失败绝不能影响启动 */
  }
}

function log(...args) {
  const line = `${new Date().toISOString()} ${args.join(' ')}\n`;
  try {
    if (!logStream) logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' });
    logStream.write(line);
  } catch {
    logSync(...args);
  }
}

process.on('uncaughtException', (err) => logSync('uncaughtException:', err && (err.stack || err)));
process.on('unhandledRejection', (err) => logSync('unhandledRejection:', err && (err.stack || err)));

// --sgs-debug 时把交互细节也写进日志，便于排查"点击没反应/拖拽误触"之类问题
// （不要用 --debug：Electron 会把它当成已废弃的 node --debug 参数而直接退出）
const DEBUG = process.argv.includes('--sgs-debug') || process.env.SGS_DEBUG === '1';
const dlog = (...args) => {
  if (DEBUG) log(...args);
};

logSync('--- boot ---', `electron=${process.versions.electron}`, `node=${process.versions.node}`);

// 透明的桌宠窗口 + 原生遮挡计算会互相干扰（窗口被判定为“被遮挡”后可能停止绘制），关掉它。
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// 便携化：Chromium 的 profile / 缓存 / 日志全部落在程序目录内，
// 不往用户目录写东西，也避免被外部策略挡住。
for (const name of ['userData', 'sessionData', 'cache', 'logs', 'crashDumps']) {
  try {
    app.setPath(name, path.join(ROOT, '.userdata', name));
  } catch {
    /* 某些 Electron 版本不一定支持每个键，忽略即可 */
  }
}
app.setPath('userData', path.join(ROOT, '.userdata'));

const NOMINAL = { width: 640, height: 240 };

let cfg = store.DEFAULT_CONFIG;
let textsData = texts.DEFAULT_TEXTS;
let state = null;
let warnings = [];
let petWin = null;
let menuWin = null;
let tray = null;
let drag = null;
let saveTimer = null;
let positioned = false;
let revealed = false;
let hotkeyRegistered = false;
let menuAnchor = null;
let quitting = false;

/* ---------------------------------------------------------------- 持久化 */

function saveStateSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveStateNow();
  }, 200);
}

function saveStateNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!state) return;
  try {
    store.saveState(STATE_PATH, state);
  } catch (err) {
    warnings.push(`状态写入失败：${err.message}`);
  }
}

/* ------------------------------------------------------------ 状态广播 */

function publicState() {
  return {
    mode: state.mode,
    clickThrough: state.clickThrough,
    skipTaskbar: state.skipTaskbar,
    background: state.background,
    hasTray: Boolean(tray),
    worldline: {
      micro: state.worldline.micro,
      text: worldline.formatMicro(state.worldline.micro),
      range: worldline.rangeLabel(state.worldline.micro),
      clicks: state.worldline.clicks,
      missesSinceSpecial: state.worldline.missesSinceSpecial,
      history: state.worldline.history.slice(-8),
    },
    hotkey: cfg.window.toggleClickThroughHotkey,
    hotkeyRegistered,
    showHideHotkey: cfg.window.showHideHotkey,
    showHideHotkeyRegistered,
    warnings,
  };
}

function broadcast() {
  const snapshot = publicState();
  for (const win of [petWin, menuWin]) {
    if (win && !win.isDestroyed()) win.webContents.send('app:state', snapshot);
  }
  updateTrayMenu();
  refreshTrayTooltip();
}

/* --------------------------------------------------------------- 模式/开关 */

/* 背景材质。none / dark / fond 是页面自己画的；acrylic 走 Windows 原生材质，
 * 而原生材质要求窗口"非透明"，所以切换到/离开它时必须重建窗口。 */
const BACKGROUNDS = ['none', 'dark', 'frosted', 'acrylic', 'fond'];
const BACKGROUND_LABELS = {
  none: '透明',
  dark: '深色玻璃',
  frosted: '磨砂毛玻璃',
  acrylic: '系统亚克力',
  fond: 'fond 背板',
};
const NATIVE_MATERIALS = ['acrylic'];

function wantsNativeMaterial(background) {
  return NATIVE_MATERIALS.includes(background || state.background);
}

function setBackground(next, source) {
  const target = BACKGROUNDS.includes(next) ? next : 'dark';
  if (state.background === target) return withSource({ changed: false }, source);

  const before = wantsNativeMaterial(state.background);
  state.background = target;
  const after = wantsNativeMaterial(target);
  saveStateSoon();
  broadcast();

  if (before !== after && petWin && !petWin.isDestroyed()) {
    recreatePetWindow();
  }
  pulse(`背景材质：${target}`);
  return withSource({ changed: true, background: target }, source);
}

function setMode(mode, source) {
  const next = mode === 'worldline' ? 'worldline' : 'time';
  if (state.mode === next) return withSource({ changed: false }, source);
  state.mode = next;
  saveStateSoon();
  broadcast();
  return withSource({ changed: true, mode: next }, source);
}

function withSource(payload, source) {
  return source ? { ...payload, source } : payload;
}

function setClickThrough(flag, source) {
  state.clickThrough = Boolean(flag);
  if (petWin && !petWin.isDestroyed()) {
    // forward: true 让窗口在穿透时仍能收到 hover 事件，便于恢复时立即响应
    petWin.setIgnoreMouseEvents(state.clickThrough, { forward: true });
  }
  // 穿透状态下鼠标点不到窗口，托盘就成了唯一出口：必须强制存在，不受配置影响。
  if (state.clickThrough) ensureTray(true);
  saveStateSoon();
  broadcast();
  syncHandle();
  const hotkey = cfg.window.toggleClickThroughHotkey;
  if (state.clickThrough) {
    pulse(`点击穿透 已开启 · 托盘图标 或 ${hotkey} 可关闭`);
    // 系统通知：穿透之后窗口点不动，必须让用户看见"怎么回来"
    notify('点击穿透已开启', `单击托盘图标即可恢复；也可以按 ${hotkey}。`);
  } else {
    pulse('点击穿透 已关闭');
  }
  return withSource({ clickThrough: state.clickThrough }, source);
}

function setSkipTaskbar(flag, source) {
  state.skipTaskbar = Boolean(flag);
  if (petWin && !petWin.isDestroyed()) petWin.setSkipTaskbar(state.skipTaskbar);
  // 隐藏任务栏图标后必须留下托盘入口，否则用户无法找回菜单。
  if (state.skipTaskbar) ensureTray(true);
  saveStateSoon();
  broadcast();
  pulse(state.skipTaskbar ? '任务栏图标已隐藏 · 入口保留在托盘' : '任务栏图标已恢复');
  return withSource({ skipTaskbar: state.skipTaskbar }, source);
}

/** 系统通知（Windows toast）。失败不影响主流程。 */
function notify(title, body) {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, silent: true });
    n.show();
  } catch (err) {
    logSync('notification failed:', err.message);
  }
}


function pulse(message) {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('app:pulse', { message });
}

/* ------------------------------------------------------------------ 托盘 */

/**
 * 托盘是"穿透状态下的唯一逃生口"，所以它不能受 showTrayIcon 约束：
 * 一旦打开穿透 / 隐藏任务栏图标，就必须强制有一个托盘图标。
 * @param {boolean} force 无视配置直接创建
 */
function ensureTray(force = false) {
  if (tray) return;
  if (!force && !cfg.window.showTrayIcon) return;
  createTray();
}

function trayTooltip() {
  if (!state) return '世界线变动率探测仪';
  const line = state.mode === 'worldline' ? `世界线模式 · ${worldline.formatMicro(state.worldline.micro)}` : '时间模式';
  const flag = state.clickThrough ? ' · 点击穿透中（单击托盘可恢复）' : '';
  return `世界线变动率探测仪｜${line}${flag}`;
}

function refreshTrayTooltip() {
  if (!tray || !state) return;
  try {
    tray.setToolTip(trayTooltip());
  } catch {
    /* 忽略 */
  }
}

function createTray() {
  if (tray) return;
  try {
    const icon = createIcon(16);
    logSync('tray icon:', JSON.stringify(describeIcon(icon)));
    tray = new Tray(icon);
  } catch (err) {
    warnings.push(`托盘图标创建失败：${err.message}`);
    logSync('tray create failed:', err.message);
    return;
  }
  tray.setToolTip(trayTooltip());

  // 诊断：让 Windows 报告它把图标放到哪了（0 尺寸通常意味着被收进了溢出区）
  setTimeout(() => {
    try {
      if (tray && !tray.isDestroyed()) logSync('tray bounds:', JSON.stringify(tray.getBounds()));
    } catch (err) {
      logSync('tray bounds failed:', err.message);
    }
  }, 1500);

  // 左键：唤出探测仪。若正处于点击穿透，顺带把它关掉——
  // 用户点托盘的本意一定是"我要操作它"，而不是再看一眼点不动的窗口。
  tray.on('click', () => {
    if (state.clickThrough) {
      setClickThrough(false, 'tray');
      notify('点击穿透已关闭', '托盘单击可以直接恢复互动。');
    }
    showPet();
  });

  tray.on('double-click', () => showPet());
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray || !state) return;
  const menu = Menu.buildFromTemplate([
    { label: '显示探测仪', click: () => showPet() },
    {
      label: '显示 / 隐藏窗口',
      click: () => toggleShowHide(),
    },
    { type: 'separator' },
    {
      label: '时间显示模式',
      type: 'radio',
      checked: state.mode === 'time',
      click: () => setMode('time', 'tray'),
    },
    {
      label: '世界线变动模式',
      type: 'radio',
      checked: state.mode === 'worldline',
      click: () => setMode('worldline', 'tray'),
    },
    { type: 'separator' },
    {
      label: '背景材质',
      submenu: BACKGROUNDS.map((mode) => ({
        label: BACKGROUND_LABELS[mode],
        type: 'radio',
        checked: state.background === mode,
        click: () => setBackground(mode, 'tray'),
      })),
    },
    { type: 'separator' },
    // 穿透开着时，把"怎么关掉它"单独提出来，放在最显眼的位置
    ...(state.clickThrough
      ? [
          {
            label: '⚠ 关闭点击穿透（恢复互动）',
            click: () => {
              setClickThrough(false, 'tray');
              showPet();
            },
          },
          { type: 'separator' },
        ]
      : []),
    {
      label: '点击穿透',
      type: 'checkbox',
      checked: state.clickThrough,
      click: (item) => setClickThrough(item.checked, 'tray'),
    },
    {
      label: '隐藏任务栏图标',
      type: 'checkbox',
      checked: state.skipTaskbar,
      click: (item) => setSkipTaskbar(item.checked, 'tray'),
    },
    { type: 'separator' },
    {
      label: hotkeyRegistered
        ? `快捷键 ${cfg.window.toggleClickThroughHotkey}：切换穿透`
        : '快捷键未注册',
      enabled: false,
    },
    { type: 'separator' },
    { label: '退出', click: () => quitApp() },
  ]);
  tray.setContextMenu(menu);
}

/* -------------------------------------------------------------- 主窗口 */

function createPetWindow() {
  const native = wantsNativeMaterial();
  const options = {
    width: NOMINAL.width,
    height: NOMINAL.height,
    frame: false,
    // 原生材质（亚克力）与逐像素透明互斥，二选一。
    // 注意：走原生材质时不能再给 backgroundColor，否则 Chromium 会铺一层实色，
    // 材质就被盖住了（实测：给了 '#00000000' 之后窗口变成不透明白板）。
    transparent: !native,
    hasShadow: false,
    resizable: false,
    movable: true,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    skipTaskbar: false,
    alwaysOnTop: cfg.window.alwaysOnTop !== false,
    show: false,
    title: '世界线变动率探测仪',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  };
  if (native) options.backgroundMaterial = state.background;
  else options.backgroundColor = '#00000000';

  petWin = new BrowserWindow(options);
  dlog('pet window created, native material =', native, state.background);

  if (cfg.window.alwaysOnTop !== false) petWin.setAlwaysOnTop(true, 'screen-saver');
  if (Number(cfg.appearance?.uiScale) && Number(cfg.appearance.uiScale) !== 1) {
    petWin.webContents.on('did-finish-load', () => {
      petWin.webContents.setZoomFactor(Math.min(2.5, Math.max(0.5, Number(cfg.appearance.uiScale))));
    });
  }

  petWin.setSkipTaskbar(Boolean(state.skipTaskbar));

  petWin.on('closed', () => {
    petWin = null;
  });
  petWin.on('move', () => {
    if (drag) return; // 拖拽中由 pointer-up 统一落盘
    captureWindowPosition();
  });

  // 穿透把手跟着桌宠走
  petWin.on('move', () => {
    if (handleWin && !handleWin.isDestroyed()) {
      const p = handlePosition();
      if (p) handleWin.setPosition(p.x, p.y);
    }
  });

  petWin.loadFile(path.join(__dirname, 'renderer', 'pet.html'));

  if (process.argv.includes('--devtools')) {
    petWin.webContents.openDevTools({ mode: 'detach' });
  }
}

/**
 * 亚克力 / 逐像素透明 之间切换必须重建窗口：
 * 这两种背景是创建期的窗口属性，运行时改不了。
 * 状态都在主进程里，重建后渲染层重新 bootstrap 即可，位置会还原。
 */
function recreatePetWindow() {
  if (!petWin || petWin.isDestroyed()) return;
  if (drag) return; // 拖拽中不重建
  const bounds = petWin.getBounds();
  const wasVisible = petWin.isVisible();
  dlog('recreatePetWindow for background =', state.background, JSON.stringify(bounds));

  petWin.destroy();
  petWin = null;
  positioned = true; // 位置沿用旧值，不要再重新定位
  revealed = false;

  createPetWindow();
  petWin.setBounds(bounds);
  if (wasVisible) {
    // did-finish-load 里会重新应用穿透/任务栏并显示
    petWin.once('ready-to-show', () => {
      if (petWin && !petWin.isDestroyed()) {
        petWin.showInactive();
        revealed = true;
      }
    });
  }
}

function captureWindowPosition() {
  if (!petWin || petWin.isDestroyed()) return;
  const { x, y } = petWin.getBounds();
  state.window = { x, y };
  saveStateSoon();
}

function clampToWorkArea() {
  if (!petWin || petWin.isDestroyed()) return;
  const b = petWin.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const nx = Math.min(Math.max(b.x, wa.x), wa.x + wa.width - b.width);
  const ny = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - b.height);
  if (nx !== b.x || ny !== b.y) petWin.setPosition(Math.round(nx), Math.round(ny));
}

function positionDefault() {
  const wa = screen.getPrimaryDisplay().workArea;
  const [w, h] = petWin.getContentSize();
  petWin.setPosition(
    Math.round(wa.x + wa.width - w - 48),
    Math.round(wa.y + wa.height - h - 72),
  );
}

function restoreOrPosition() {
  const saved = state.window;
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    petWin.setPosition(Math.round(saved.x), Math.round(saved.y));
    clampToWorkArea();
  } else {
    positionDefault();
  }
  positioned = true;
}

function showPet() {
  if (!petWin || petWin.isDestroyed()) return;
  // 手动唤回就取消"自动恢复"定时器，避免重复
  if (autoShowTimer) {
    clearTimeout(autoShowTimer);
    autoShowTimer = null;
  }
  // 分辨率变化或显示器断开后，旧坐标可能落在屏幕外，先夹回可见区域再显示
  clampToWorkArea();
  if (cfg.window.alwaysOnTop !== false) petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.show();
  petWin.focus();
  syncHandle();
  logSync('showPet: visible =', petWin.isVisible());
}

let autoShowTimer = null;

/**
 * 托盘图标到底有没有被系统显示出来？
 * Electron 文档：图标在溢出区时 getBounds() 返回全 0。
 * 但那也意味着"用户在这个位置点不到它"，所以只要宽度为 0 就当作不可见。
 */
function trayIconVisible() {
  if (!tray || tray.isDestroyed()) return false;
  try {
    const b = tray.getBounds();
    return Boolean(b && b.width > 0 && b.height > 0);
  } catch {
    return false;
  }
}

function hidePet() {
  if (!petWin || petWin.isDestroyed()) return;
  petWin.hide();
  syncHandle();

  // 关键兜底：如果托盘图标在系统里根本不可见（这台机器就是这样），
  // 隐藏就等于把自己弄丢。此时定时把窗口放回来，绝不把用户困住。
  if (autoShowTimer) clearTimeout(autoShowTimer);
  if (!trayIconVisible()) {
    const ms = Number(cfg.window.autoShowIfTrayHiddenMs ?? 15000);
    if (ms > 0) {
      logSync('tray icon not visible -> auto show in', ms, 'ms');
      autoShowTimer = setTimeout(() => {
        autoShowTimer = null;
        if (!petWin || petWin.isDestroyed() || petWin.isVisible()) return;
        showPet();
        pulse('托盘图标在当前系统里不可见，已自动把窗口放回');
        logSync('auto show: restored window because tray icon is invisible');
      }, ms);
    }
  }
}

/* ---------------------------------------------------- 穿透时的"恢复把手" ---- */

/**
 * 点击穿透之后，桌宠本身点不动了。托盘图标在部分 Windows 环境下不会被 shell 显示，
 * 全局快捷键又可能被 IME 等功能抢走，所以这里再兜一层：
 * 穿透期间在桌宠角上浮出一个 26x26 的小把手窗口，它**永远不穿透**，点一下就恢复互动。
 * 这是唯一不依赖托盘、快捷键、输入法的入口。
 */
const HANDLE_SIZE = 26;
let handleWin = null;

function handlePosition() {
  if (!petWin || petWin.isDestroyed()) return null;
  const b = petWin.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  let x = b.x + b.width - Math.round(HANDLE_SIZE * 0.35);
  let y = b.y - Math.round(HANDLE_SIZE * 0.55);
  // 别让把手跑到屏幕外
  x = Math.min(Math.max(x, wa.x), wa.x + wa.width - HANDLE_SIZE);
  y = Math.min(Math.max(y, wa.y), wa.y + wa.height - HANDLE_SIZE);
  return { x: Math.round(x), y: Math.round(y) };
}

function showHandle() {
  if (handleWin && !handleWin.isDestroyed()) {
    const p = handlePosition();
    if (p) handleWin.setPosition(p.x, p.y);
    handleWin.showInactive();
    return;
  }
  const p = handlePosition();
  if (!p) return;
  handleWin = new BrowserWindow({
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    x: p.x,
    y: p.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: true,
    alwaysOnTop: true,
    show: false,
    title: '恢复互动',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  handleWin.setAlwaysOnTop(true, 'screen-saver');
  handleWin.loadFile(path.join(__dirname, 'renderer', 'handle.html'));  handleWin.once('ready-to-show', () => {
    if (handleWin && !handleWin.isDestroyed()) {
      handleWin.showInactive();
      // 桌宠也是 'screen-saver' 级置顶，必须显式抬到最前，否则小把手会被压在下面点不到
      handleWin.moveTop();
    }
  });
  handleWin.on('closed', () => {
    handleWin = null;
  });
  logSync('handle window shown for click-through');
}

function hideHandle() {
  if (handleWin && !handleWin.isDestroyed()) handleWin.destroy();
  handleWin = null;
}

function syncHandle() {
  if (state && state.clickThrough && petWin && !petWin.isDestroyed() && petWin.isVisible()) {
    showHandle();
  } else {
    hideHandle();
  }
}

/* ------------------------------------------------------------------ 素材 ---- */

/**
 * 素材目录约定：
 *   src/assets-default/  仓库里提交的自绘素材（许可干净，公开版出厂外观）
 *   src/assets/          运行时目录；prepare-assets.ps1 会把你自己准备的图生成到这里
 *
 * 之所以这样分：image/ 里的原作素材不能进公开仓库，但本机又想保留原外观，
 * 所以让 assets/ 既可被覆盖又不入库。
 */
const ASSETS_DIR = path.join(__dirname, 'assets');
const ASSETS_DEFAULT_DIR = path.join(__dirname, 'assets-default');

function copyDirSync(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDirSync(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

function ensureAssets() {
  const probe = path.join(ASSETS_DIR, 'tubes', '0.png');
  if (fs.existsSync(probe)) {
    logSync('assets: using', ASSETS_DIR);
    return;
  }
  try {
    copyDirSync(ASSETS_DEFAULT_DIR, ASSETS_DIR);
    logSync('assets: seeded from assets-default');
  } catch (err) {
    // 只读安装目录（例如 Program Files）下会失败；此时仍能用默认素材，
    // 但渲染层是按 assets/ 取图的，所以把这个情况写进日志方便排查。
    logSync('assets: seed failed ->', err.message);
  }
}
/* -------------------------------------------------------------- 右键菜单 */

const MENU_SIZE = { width: 256, height: 336 };

function openMenu() {
  if (menuWin && !menuWin.isDestroyed()) {
    closeMenu();
    return { open: false, reason: 'toggled' };
  }
  menuAnchor = screen.getCursorScreenPoint();
  dlog('openMenu at', menuAnchor.x, menuAnchor.y);
  const { workArea } = screen.getDisplayNearestPoint(menuAnchor);
  // 先按名义尺寸粗略定位，等渲染层回报实际尺寸后再精确对齐。
  const x = Math.min(Math.max(menuAnchor.x + 2, workArea.x), workArea.x + workArea.width - MENU_SIZE.width);
  const y = Math.min(Math.max(menuAnchor.y + 2, workArea.y), workArea.y + workArea.height - MENU_SIZE.height);

  menuWin = new BrowserWindow({
    width: MENU_SIZE.width,
    height: MENU_SIZE.height,
    x: Math.round(x),
    y: Math.round(y),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    show: false,
    title: '菜单',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  menuWin.setAlwaysOnTop(true, 'screen-saver');
  menuWin.loadFile(path.join(__dirname, 'renderer', 'menu.html'));
  dlog('menu window created');

  menuWin.once('ready-to-show', () => {
    if (!menuWin || menuWin.isDestroyed()) return;
    menuWin.show();
    menuWin.focus();
    dlog('menu ready-to-show; focused =', menuWin.isFocused());
  });
  menuWin.on('blur', () => {
    dlog('menu blur');
    closeMenu('blur');
  });
  menuWin.on('closed', () => {
    menuWin = null;
    menuAnchor = null;
  });

  return { open: true };
}

function closeMenu(reason) {
  dlog('closeMenu reason=', reason || 'explicit');
  if (menuWin && !menuWin.isDestroyed()) menuWin.destroy();
  menuWin = null;
  return { closed: true, reason: reason || 'explicit' };
}

function placeMenu(w, h) {
  if (!menuWin || menuWin.isDestroyed() || !menuAnchor) return;
  const { workArea } = screen.getDisplayNearestPoint(menuAnchor);
  let x = menuAnchor.x + 2;
  let y = menuAnchor.y + 2;
  if (x + w > workArea.x + workArea.width) x = Math.max(workArea.x, menuAnchor.x - w);
  if (y + h > workArea.y + workArea.height) y = Math.max(workArea.y, menuAnchor.y - h);
  menuWin.setBounds({ x: Math.round(x), y: Math.round(y), width: w, height: h });
}

/* ------------------------------------------------------------ 菜单动作 */

function handleMenuAction(action) {
  if (typeof action === 'string' && action.startsWith('background:')) {
    return setBackground(action.slice('background:'.length), 'menu');
  }
  switch (action) {
    case 'mode:time':
      return setMode('time', 'menu');
    case 'mode:worldline':
      return setMode('worldline', 'menu');
    case 'toggle:clickThrough':
      return setClickThrough(!state.clickThrough, 'menu');
    case 'toggle:skipTaskbar':
      return setSkipTaskbar(!state.skipTaskbar, 'menu');
    case 'hide:tray':
      hidePet();
      return { hidden: true };
    case 'show:pet':
      showPet();
      return { hidden: false };
    case 'quit':
      quitApp();
      return { quitting: true };
    default:
      return { error: `unknown action: ${action}` };
  }
}

/* ------------------------------------------------------------ 指针 / 拖拽 */

let dragTimer = null;

function stopDragTimer() {
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
}

/**
 * 用主进程轮询光标位置来拖拽窗口：窗口本身在光标下移动，
 * 渲染进程的 mousemove 会不可靠，轮询是唯一稳定的做法。
 * 位移超过阈值才移动窗口，因此「单击」永远不会触发拖拽，反之亦然。
 */
function pointerDown() {
  if (!petWin || petWin.isDestroyed()) return { ok: false };
  stopDragTimer();
  const cursor = screen.getCursorScreenPoint();
  const [x, y] = petWin.getPosition();
  drag = { startCursor: cursor, startPos: { x, y }, moved: 0 };
  dlog('pointerDown cursor=', cursor.x, cursor.y, 'pos=', x, y);
  const threshold = Math.max(1, Number(cfg.interaction?.dragThresholdPx) || 5);
  dragTimer = setInterval(() => {
    if (!drag || !petWin || petWin.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    const dx = p.x - drag.startCursor.x;
    const dy = p.y - drag.startCursor.y;
    const dist = Math.hypot(dx, dy);
    if (dist > drag.moved) drag.moved = dist;
    if (dist > threshold) {
      petWin.setPosition(Math.round(drag.startPos.x + dx), Math.round(drag.startPos.y + dy));
    }
  }, 16);
  return { ok: true };
}

function pointerUp() {
  stopDragTimer();
  const moved = drag ? drag.moved : 0;
  drag = null;
  const threshold = Math.max(1, Number(cfg.interaction?.dragThresholdPx) || 5);
  const dragged = moved > threshold;
  dlog('pointerUp moved=', moved, 'dragged=', dragged);
  if (dragged) {
    clampToWorkArea();
    captureWindowPosition();
  }
  return { dragged, moved: Math.round(moved) };
}

/* ------------------------------------------------------------- 点击逻辑 */

function handlePetClick() {
  if (!state) return { kind: 'none' };
  if (state.mode === 'time') {
    return {
      kind: 'time',
      clock: worldline.formatTime(new Date(), cfg),
      range: null,
    };
  }

  const result = worldline.nextValue(cfg, state.worldline.micro, state.worldline.missesSinceSpecial);
  state.worldline.micro = result.micro;
  state.worldline.clicks += 1;

  // 数值只由 worldline.js 决定；标签/台词/章节统一从 texts.json 查（按管面显示值）
  let special = null;
  if (result.special) {
    const copy = texts.resolve(textsData, result.micro, worldline.formatMicro, worldline.rangeLabel);
    special = { ...result.special, ...copy };
    state.worldline.missesSinceSpecial = 0;
    state.worldline.history.push({
      value: result.special.value,
      label: copy.label,
      at: new Date().toISOString(),
    });
    if (state.worldline.history.length > 50) state.worldline.history.shift();
  } else {
    state.worldline.missesSinceSpecial += 1;
  }

  saveStateSoon();
  broadcast();
  dlog('click ->', special ? 'SPECIAL' : 'drift', worldline.formatMicro(result.micro), 'delta=', result.delta);

  return {
    kind: 'worldline',
    micro: result.micro,
    text: worldline.formatMicro(result.micro),
    special,
    forced: result.forced,
    delta: result.delta,
    range: result.range,
    clicks: state.worldline.clicks,
  };
}

/* ---------------------------------------------------------------- 生命周期 */

function quitApp() {
  quitting = true;
  saveStateNow();
  app.quit();
}

let showHideHotkeyRegistered = false;

function toggleShowHide() {
  if (!petWin || petWin.isDestroyed()) return;
  if (petWin.isVisible()) {
    hidePet();
    logSync('hotkey: hidden');
  } else {
    showPet();
    logSync('hotkey: shown');
  }
}

function registerHotkey() {
  const accel = cfg.window.toggleClickThroughHotkey;
  if (accel) {
    try {
      hotkeyRegistered = globalShortcut.register(accel, () => {
        logSync('hotkey fired: toggle clickThrough, current =', state.clickThrough);
        setClickThrough(!state.clickThrough, 'hotkey');
      });
    } catch {
      hotkeyRegistered = false;
    }
    if (!hotkeyRegistered) {
      warnings.push(`快捷键 ${accel} 注册失败（可能已被占用），请改用托盘菜单切换穿透`);
    }
  }

  // 唤回快捷键：托盘图标在部分环境下不会被系统显示（见 README），
  // 所以"隐藏之后怎么找回来"必须有一条不依赖托盘的硬通道。
  const showHide = cfg.window.showHideHotkey;
  if (showHide) {
    try {
      showHideHotkeyRegistered = globalShortcut.register(showHide, () => toggleShowHide());
    } catch {
      showHideHotkeyRegistered = false;
    }
    if (!showHideHotkeyRegistered) {
      warnings.push(`唤回快捷键 ${showHide} 注册失败（可能已被占用）`);
    }
  }
  logSync(
    'hotkeys: clickThrough =',
    hotkeyRegistered,
    `(${accel})`,
    'showHide =',
    showHideHotkeyRegistered,
    `(${showHide})`,
  );
}

function registerIpc() {
  ipcMain.handle('app:bootstrap', () => ({
    config: cfg,
    state: publicState(),
    // 文案：牌子名 + 两种模式的状态行。逐条世界线文案按需从主进程返回。
    texts: { brand: textsData.brand, status: textsData.status },
    platform: process.platform,
    warnings,
  }));

  ipcMain.handle('pet:size', (_event, size) => {
    if (!petWin || petWin.isDestroyed() || !size) return;
    const w = Math.max(160, Math.min(2400, Math.ceil(size.w)));
    const h = Math.max(80, Math.min(1400, Math.ceil(size.h)));
    const [cw, ch] = petWin.getContentSize();
    if (w !== cw || h !== ch) petWin.setContentSize(w, h);
    if (!positioned) restoreOrPosition();
    else if (!drag) clampToWorkArea();
    if (!revealed && !cfg.window.hideOnStart) {
      petWin.showInactive();
      revealed = true;
    }
  });

  ipcMain.handle('window:pointerDown', () => pointerDown());
  ipcMain.handle('window:pointerUp', () => pointerUp());
  ipcMain.handle('pet:click', () => handlePetClick());
  // 穿透把手被点击：关掉穿透并唤出窗口（不依赖托盘/快捷键）
  ipcMain.handle('handle:click', () => {
    logSync('handle clicked -> disabling click-through');
    setClickThrough(false, 'handle');
    showPet();
    return { ok: true };
  });

  ipcMain.handle('app:setMode', (_e, mode) => {
    setMode(mode, 'ui');
    return publicState();
  });

  ipcMain.handle('menu:open', () => openMenu());
  ipcMain.handle('menu:close', () => closeMenu('explicit'));
  ipcMain.handle('menu:state', () => publicState());
  ipcMain.handle('menu:action', (_e, action) => {
    const result = handleMenuAction(action);
    // 切换穿透后故意让菜单留在原地：菜单窗口本身不受穿透影响，
    // 用户可以立刻再点一次撤销，不用去找托盘。
    const keepOpen =
      action === 'quit' || action === 'show:pet' || action === 'toggle:clickThrough';
    if (!keepOpen) closeMenu('action');
    return result;
  });
  ipcMain.on('menu:size', (_event, size) => {
    if (!size) return;
    placeMenu(Math.max(160, Math.ceil(size.w)), Math.max(120, Math.ceil(size.h)));
  });
}

function bootstrap() {
  logSync('bootstrap: loading config', 'dataRoot =', DATA_ROOT);

  // 素材：仓库只带 assets-default，这里保证 assets/ 存在（缺了就铺默认素材）
  ensureAssets();

  // 绿色版首次运行：把随包附带的配置/文案复制到 exe 旁边，用户才好改
  if (app.isPackaged) {
    for (const name of ['config.json', 'texts.json']) {
      const dst = path.join(DATA_ROOT, name);
      const src = path.join(ROOT, name);
      try {
        if (!fs.existsSync(dst) && fs.existsSync(src)) {
          fs.copyFileSync(src, dst);
          logSync('seeded', name, 'next to exe');
        }
      } catch (err) {
        logSync('seed failed:', name, err.message);
      }
    }
  }

  const loaded = store.loadConfig(CONFIG_PATH);
  cfg = loaded.config;
  warnings = [...loaded.warnings];

  const loadedTexts = texts.loadTexts(TEXTS_PATH);
  textsData = loadedTexts.texts;
  warnings.push(...loadedTexts.warnings);

  state = store.loadState(STATE_PATH, cfg);

  // 首次启动（没有 state.json）或 restoreLastMode=false 时，一律从 startMode 开始。
  // 其余情况恢复上次的模式——这是"模式要持久化"的直接体现。
  if (cfg.window.restoreLastMode === false) {
    state.mode = cfg.window.startMode === 'worldline' ? 'worldline' : 'time';
  }
  logSync('bootstrap: config ok, mode =', state.mode, 'warnings =', warnings.join(' | ') || 'none');

  registerIpc();
  createPetWindow();
  logSync('bootstrap: pet window created');

  // 启动时若已处于穿透状态，把手要一起出来
  if (state.clickThrough) syncHandle();

  if (cfg.window.showTrayIcon) createTray();
  registerHotkey();
  // 上次退出时若处于穿透/无任务栏状态，托盘必须存在，否则这次启动就点不到窗口了
  if (state.clickThrough || state.skipTaskbar) ensureTray(true);
  logSync('bootstrap: tray =', Boolean(tray), 'hotkey =', hotkeyRegistered);

  // 初始化引脚状态（穿透 / 任务栏）在窗口就绪后应用
  petWin.webContents.on('did-finish-load', () => {
    logSync('pet: did-finish-load');
    if (state.clickThrough) petWin.setIgnoreMouseEvents(true, { forward: true });
    if (state.skipTaskbar) petWin.setSkipTaskbar(true);
    if (state.clickThrough || state.skipTaskbar) ensureTray();
    broadcast();
  });
  petWin.webContents.on('did-fail-load', (_e, code, desc) => {
    logSync('pet: did-fail-load', code, desc);
  });
  petWin.webContents.on('render-process-gone', (_e, details) => {
    logSync('pet: render-process-gone', JSON.stringify(details));
  });
}

logSync('requestSingleInstanceLock');
if (!app.requestSingleInstanceLock()) {
  logSync('single instance lock NOT acquired -> quitting');
  app.quit();
} else {
  logSync('single instance lock acquired');
  app.on('second-instance', () => {
    if (petWin && !petWin.isDestroyed()) {
      if (!petWin.isVisible()) petWin.show();
      petWin.focus();
    }
  });

  app.on('before-quit', () => {
    quitting = true;
    saveStateNow();
    logSync('before-quit');
  });

  app.whenReady().then(() => {
    logSync('app ready; userData =', app.getPath('userData'));
    app.setAppUserModelId('com.dsh.sgs.worldline-detector');
    bootstrap();

    app.on('activate', () => {
      if (petWin && !petWin.isDestroyed()) showPet();
    });
  });

  // 桌宠是常驻的：关掉菜单窗口不应该退出进程。
  app.on('window-all-closed', () => {
    if (quitting) app.quit();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (tray) {
      tray.destroy();
      tray = null;
    }
  });
}

module.exports = { MENU_SIZE };
