'use strict';

/**
 * 文案加载：texts.json 是所有"给人看的字"的唯一来源。
 *   - brand           牌子名称（原 AMADEUS）
 *   - status.time     时间模式里品牌后面那句
 *   - status.worldline 世界线模式里品牌后面那句
 *   - worldlines[键]  每条特殊世界线的 label / quote / chapter
 *
 * 键 = 管面上显示的数字（负值按幅值，菲利斯线用 0.275349）。
 * 文件缺失或损坏时用内置默认值重建，不会让界面变成空白。
 */

const fs = require('node:fs');
const path = require('node:path');

const { writeJsonAtomic } = require('./store');

const DEFAULT_TEXTS = {
  brand: 'AMADEUS',
  status: {
    time: '观测链路稳定',
    worldline: '收束范围监测',
  },
  worldlines: {
    '1.048596': { label: 'Steins;Gate 世界线', quote: '「一切都是 Steins;Gate 的选择」', chapter: '第十章' },
    '1.123581': { label: 'Steins;Gate 0 真结局', quote: '斐波那契序列 · 1 1 2 3 5 8 13 21', chapter: '《命运石之门 0》' },
    '1.130426': { label: 'β 世界线', quote: '一切开始之前的那条线', chapter: '' },
    '1.129848': { label: 'β 分歧点', quote: '重要分歧点附近', chapter: '' },
    '1.382733': { label: 'β 变动', quote: '俄罗斯时间机器实验之后', chapter: '' },
    '1.130205': { label: 'β 世界线', quote: '2010-08-17 · 删除第一封 D-mail', chapter: '红莉栖 END' },
    '1.130238': { label: 'β 世界线', quote: '2010-08-17 · 删除第一封 D-mail', chapter: '真由理 END' },
    '0.571024': { label: 'α 世界线', quote: '2010-07-28 · 第一封 D-mail 之后', chapter: '' },
    '0.571015': { label: 'α 六合彩', quote: '2010-07-28 · 六合彩 D-mail', chapter: '' },
    '0.523307': { label: 'α 世界线', quote: '2010-08-15 · 四千次时间跳跃之后', chapter: '' },
    '0.523299': { label: 'α 世界线', quote: '2010-07-31 · IBN5100 被夺走', chapter: '' },
    '0.456903': { label: 'α 世界线', quote: '2010-08-06 · 琉华子的 D-mail', chapter: '' },
    '0.409420': { label: 'α 世界线', quote: '2010-08-07 · 菲利斯寄往 2000 年的 D-mail', chapter: '' },
    '0.337187': { label: 'α 世界线', quote: '2010-08-10 · 尾行铃羽的 D-mail', chapter: '' },
    '0.275349': { label: '菲利斯线', quote: '负向变动率 · 探测仪不显示负号', chapter: '' },
    '2.615074': { label: 'γ 收束范围', quote: '广播剧《暗黑次元的海德》', chapter: '广播剧' },
    '2.999999': { label: 'γ 边界', quote: 'γ 收束范围的边缘', chapter: '' },
  },
};

function mergeTexts(base, extra) {
  const out = {
    brand: typeof extra?.brand === 'string' && extra.brand ? extra.brand : base.brand,
    status: {
      time: typeof extra?.status?.time === 'string' && extra.status.time ? extra.status.time : base.status.time,
      worldline:
        typeof extra?.status?.worldline === 'string' && extra.status.worldline
          ? extra.status.worldline
          : base.status.worldline,
    },
    worldlines: { ...base.worldlines },
  };
  const custom = extra?.worldlines;
  if (custom && typeof custom === 'object') {
    for (const [key, value] of Object.entries(custom)) {
      if (!value || typeof value !== 'object') continue;
      const prev = out.worldlines[key] || {};
      out.worldlines[key] = {
        label: typeof value.label === 'string' && value.label ? value.label : prev.label || '',
        quote: typeof value.quote === 'string' ? value.quote : prev.quote || '',
        chapter: typeof value.chapter === 'string' ? value.chapter : prev.chapter || '',
      };
    }
  }
  return out;
}

function loadTexts(file) {
  const warnings = [];
  if (!fs.existsSync(file)) {
    try {
      writeJsonAtomic(file, DEFAULT_TEXTS);
      warnings.push('texts.json 缺失，已按默认文案重建');
    } catch (err) {
      warnings.push(`texts.json 写入失败：${err.message}`);
    }
    return { texts: DEFAULT_TEXTS, warnings };
  }

  let raw;
  try {
    let content = fs.readFileSync(file, 'utf8');
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1); // 记事本的 BOM
    raw = JSON.parse(content);
  } catch (err) {
    const backup = `${file}.broken-${Date.now()}`;
    try {
      fs.copyFileSync(file, backup);
    } catch {
      /* 备份失败不影响继续 */
    }
    try {
      writeJsonAtomic(file, DEFAULT_TEXTS);
    } catch {
      /* 忽略 */
    }
    warnings.push(`texts.json 解析失败，已备份为 ${path.basename(backup)} 并重建默认文案`);
    return { texts: DEFAULT_TEXTS, warnings };
  }

  return { texts: mergeTexts(DEFAULT_TEXTS, raw), warnings };
}

/**
 * 取某条世界线的文案。找不到条目时退回收束范围名，保证界面上永远不会是空的。
 * @param {number} micro 微单位变动率
 * @param {(micro:number)=>string} formatMicro 显示用格式化函数（内部会取幅值）
 * @param {(micro:number)=>string} rangeLabel 收束范围名
 */
function resolve(texts, micro, formatMicro, rangeLabel) {
  const key = formatMicro(micro);
  const entry = texts.worldlines[key];
  if (entry) {
    return {
      label: entry.label || `${rangeLabel(micro)} 世界线`,
      quote: entry.quote || '',
      chapter: entry.chapter || '',
    };
  }
  return { label: `${rangeLabel(micro)} 世界线`, quote: '', chapter: '' };
}

module.exports = { DEFAULT_TEXTS, loadTexts, mergeTexts, resolve };
