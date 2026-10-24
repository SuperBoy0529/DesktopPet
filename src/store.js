'use strict';

/**
 * 配置与状态持久化。
 * - config.json：用户手动编辑的全部可调参数（只读，程序不覆盖用户修改）
 * - state/state.json：运行时状态（模式、穿透开关、当前变动率、特殊值历史），重启后恢复
 */

const fs = require('node:fs');
const path = require('node:path');

/** 与 config.json 保持一致的兜底默认值：仅在 config.json 缺失/损坏时用于重建。 */
const DEFAULT_CONFIG = {
  window: {
    alwaysOnTop: true,
    startMode: 'time',
    restoreLastMode: true,
    clickThrough: false,
    showTrayIcon: true,
    hideTaskbarIcon: false,
    hideOnStart: false,
    rememberPosition: true,
    toggleClickThroughHotkey: 'Control+Alt+Shift+D',
    showHideHotkey: 'Control+Alt+Shift+S',
    // 托盘图标不可见时（Windows 常把它塞进溢出区且 getBounds() 全 0），
    // 隐藏窗口后自动放回来的等待时间；0 = 关闭这个兜底
    autoShowIfTrayHiddenMs: 15000,
  },
  time: { format: 'HH:MM:SS', twentyFourHour: true },
  worldline: {
    min: 0.0,
    max: 2.999999,
    initialValue: 1.048596,
    specialChance: 0.05,
    pityAfterMisses: 60,
    deltaTiers: [
      { weight: 0.88, min: 1, max: 99 },
      { weight: 0.09, min: 100, max: 9999 },
      { weight: 0.03, min: 10000, max: 400000 },
    ],
    specialValues: [
      { value: 1.048596, weight: 0.9 },
      { value: 1.123581, weight: 0.9 },
      { value: 1.130426, weight: 1.0 },
      { value: 1.129848, weight: 1.0 },
      { value: 1.382733, weight: 1.0 },
      { value: 1.130205, weight: 1.0 },
      { value: 1.130238, weight: 1.0 },
      { value: 0.571024, weight: 1.0 },
      { value: 0.571015, weight: 1.0 },
      { value: 0.523307, weight: 0.8 },
      { value: 0.523299, weight: 0.8 },
      { value: 0.456903, weight: 1.0 },
      { value: 0.409420, weight: 1.0 },
      { value: 0.337187, weight: 1.0 },
      { value: -0.275349, weight: 0.7 },
      { value: 2.615074, weight: 1.0 },
      { value: 2.999999, weight: 0.7 },
    ],
  },
  interaction: {
    dragThresholdPx: 5,
    specialAnimationMs: 820,
    specialLabelHoldMs: 6000,
  },
  appearance: {
    uiScale: 1.0,
    showHeader: true,
    scanlines: false,
    background: 'frosted',
  },
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 深度合并：用户配置里缺的键用默认值补齐，数组整体覆盖。 */
function deepMerge(base, extra) {
  if (!isPlainObject(base) || !isPlainObject(extra)) {
    return extra === undefined ? base : extra;
  }
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (key.startsWith('_')) continue;
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** 原子写入：先写临时文件再改名，避免断电/崩溃留下半个 JSON。 */
function writeJsonAtomic(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try {
    let text = fs.readFileSync(file, 'utf8');
    // 记事本 / Windows PowerShell 的 UTF8 会写 BOM，而 JSON.parse 不接受。
    // 不剥掉的话，用户手改的 config.json 会被误判为"损坏"并重建默认值。
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return JSON.parse(text);
  } catch (err) {
    return { error: err };
  }
}

function loadConfig(configPath) {
  const warnings = [];
  if (!fs.existsSync(configPath)) {
    writeJsonAtomic(configPath, DEFAULT_CONFIG);
    warnings.push('config.json 缺失，已按默认值重建');
    return { config: DEFAULT_CONFIG, warnings };
  }
  const parsed = readJson(configPath);
  if (parsed.error) {
    const backup = `${configPath}.broken-${Date.now()}`;
    try {
      fs.copyFileSync(configPath, backup);
    } catch {
      /* 备份失败不影响继续运行 */
    }
    writeJsonAtomic(configPath, DEFAULT_CONFIG);
    warnings.push(`config.json 解析失败，已备份为 ${path.basename(backup)} 并重建默认值`);
    return { config: DEFAULT_CONFIG, warnings };
  }
  return { config: deepMerge(DEFAULT_CONFIG, parsed), warnings };
}

function defaultState(config) {
  const initial = Math.round(Number(config.worldline.initialValue) * 1000000);
  return {
    version: 1,
    mode: config.window.startMode === 'worldline' ? 'worldline' : 'time',
    clickThrough: Boolean(config.window.clickThrough),
    skipTaskbar: Boolean(config.window.hideTaskbarIcon),
    // 背景材质：运行时可在右键菜单切换，这里记录当前选择
    background: config.appearance?.background || 'frosted',
    window: null,
    worldline: {
      micro: Number.isFinite(initial) ? initial : 1048596,
      missesSinceSpecial: 0,
      clicks: 0,
      history: [],
    },
  };
}

function loadState(statePath, config) {
  const base = defaultState(config);
  if (!fs.existsSync(statePath)) return base;
  const parsed = readJson(statePath);
  if (parsed.error) return base;
  const merged = deepMerge(base, parsed);
  // 守卫：任何非法值都退回默认，避免坏状态导致窗口跑到屏幕外或数值溢出。
  if (merged.mode !== 'time' && merged.mode !== 'worldline') merged.mode = base.mode;
  if (!['none', 'dark', 'frosted', 'acrylic', 'fond'].includes(merged.background)) {
    merged.background = base.background;
  }
  if (!Number.isFinite(merged.worldline?.micro)) merged.worldline.micro = base.worldline.micro;
  if (!Array.isArray(merged.worldline?.history)) merged.worldline.history = [];
  return merged;
}

function saveState(statePath, state) {
  writeJsonAtomic(statePath, state);
}

module.exports = {
  DEFAULT_CONFIG,
  deepMerge,
  writeJsonAtomic,
  loadConfig,
  loadState,
  saveState,
};
