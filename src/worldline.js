'use strict';

/**
 * 世界线变动率核心逻辑（纯函数，不依赖 Electron，可直接用 node 测试）。
 *
 * 数值以“微单位整数”存储：micro = 变动率 × 1e6，范围 0 … 2999999，
 * 因此 8 位辉光管永远可以无损显示，也不会出现浮点误差（1.048596 不会变成 1.0485959…）。
 */

const MICRO = 1000000;

function toMicro(value) {
  return Math.round(Number(value) * MICRO);
}

function fromMicro(micro) {
  return micro / MICRO;
}

/** 把 micro 夹在配置范围内，并保证是合法整数。 */
function clampMicro(micro, cfg) {
  const min = toMicro(cfg.worldline.min);
  const max = toMicro(cfg.worldline.max);
  const m = Math.round(Number(micro) || 0);
  return Math.min(max, Math.max(min, m));
}

/**
 * 格式化为 8 字符：个位 + '.' + 六位小数，例如 1.048596。
 * 负向值不显示负号（原作探测仪的显示限制），按幅值显示：
 * 菲利斯线的 -0.275349 会显示为 0.275349。
 */
function formatMicro(micro) {
  const m = Math.min(2999999, Math.abs(Math.round(Number(micro) || 0)));
  const unit = Math.floor(m / MICRO);
  const frac = m % MICRO;
  return `${unit}.${String(frac).padStart(6, '0')}`;
}

/** 8 个管位的字形数组：['1','.','0','4','8','5','9','6'] */
function glyphsForMicro(micro) {
  return formatMicro(micro).split('');
}

/** 时间模式：HH:MM:SS 同样是 8 个管位（冒号占位）。 */
function glyphsForTime(date, cfg) {
  const h24 = !cfg || !cfg.time || cfg.time.twentyFourHour !== false;
  let h = date.getHours();
  if (!h24) h = h % 12 === 0 ? 12 : h % 12;
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(date.getMinutes())}:${p2(date.getSeconds())}`.split('');
}

function formatTime(date, cfg) {
  return glyphsForTime(date, cfg).join('');
}

/** 收束范围：α ≈ 0–1%，β ≈ 1–2%，γ ≈ 2–3%。 */
function rangeLabel(micro) {
  const v = fromMicro(micro);
  if (v < 1) return 'α';
  if (v < 2) return 'β';
  return 'γ';
}

function pickWeighted(items, rnd) {
  const total = items.reduce((sum, it) => sum + Math.max(0, Number(it.weight) || 0), 0);
  if (total <= 0) return items[0];
  let r = rnd() * total;
  for (const item of items) {
    r -= Math.max(0, Number(item.weight) || 0);
    if (r < 0) return item;
  }
  return items[items.length - 1];
}

/**
 * 计算一次“轻微偏移”。绝大多数情况只动小数点后末两位，
 * 少数情况才牵动更靠前的位数（由 config.worldline.deltaTiers 控制）。
 */
function randomDelta(cfg, rnd) {
  const tiers = (cfg.worldline.deltaTiers || []).filter((t) => Number(t.max) >= Number(t.min));
  if (!tiers.length) return 1;
  const tier = pickWeighted(tiers, rnd);
  const min = Math.max(1, Math.round(Number(tier.min)));
  const max = Math.max(min, Math.round(Number(tier.max)));
  const span = max - min + 1;
  return min + Math.floor(rnd() * span);
}

function pickSpecial(cfg, currentMicro, rnd) {
  const all = cfg.worldline.specialValues || [];
  // 排除当前值，保证“点击后数值一定变化”。
  const pool = all.filter((s) => toMicro(s.value) !== currentMicro);
  const usable = pool.length ? pool : all;
  if (!usable.length) return null;
  const chosen = pickWeighted(usable, rnd);
  // 这里只负责数值；标签 / 台词 / 章节由 texts.js 按"显示值"查找
  return { micro: toMicro(chosen.value), value: chosen.value };
}

/**
 * 一次点击后的新状态。
 * @returns {{micro:number, special:null|{micro:number,label:string,value:number},
 *            forced:boolean, delta:number, range:string}}
 */
function nextValue(cfg, currentMicro, missesSinceSpecial, rnd) {
  const random = rnd || Math.random;
  const maxMicro = toMicro(cfg.worldline.max);
  // 负值只可能来自特殊世界线（如菲利斯线 -0.275349），必须原样保留：
  // 若在这里 clamp 回 0，它会在下一次点击时凭空跳一下再被显示。
  const cur = Math.max(-999999, Math.min(maxMicro, Math.round(Number(currentMicro) || 0)));

  const specialChance = Number(cfg.worldline.specialChance) || 0;
  const pity = Number(cfg.worldline.pityAfterMisses) || 0;

  const pityHit = pity > 0 && missesSinceSpecial >= pity;
  const rollHit = random() < specialChance;

  if (pityHit || rollHit) {
    const picked = pickSpecial(cfg, cur, random);
    if (picked) {
      return {
        micro: picked.micro,
        special: picked,
        forced: pityHit && !rollHit,
        delta: picked.micro - cur,
        range: rangeLabel(picked.micro),
      };
    }
  }

  // 当前值若已在负值区，允许它继续在负区小步漂移；
  // 否则会被夹回 0，瞬间跳掉 0.27，违背"变化幅度轻微"。
  const minMicro = Math.min(toMicro(cfg.worldline.min), cur);
  const clampLocal = (m) => Math.min(maxMicro, Math.max(minMicro, m));

  const sign = random() < 0.5 ? -1 : 1;
  let next = clampLocal(cur + sign * randomDelta(cfg, random));

  // 保证每次都真的变化：夹到边界时反向微调一格。
  if (next === cur) {
    if (cur < maxMicro) next = cur + 1;
    else if (cur > minMicro) next = cur - 1;
  }

  return {
    micro: next,
    special: null,
    forced: false,
    delta: next - cur,
    range: rangeLabel(next),
  };
}

module.exports = {
  MICRO,
  toMicro,
  fromMicro,
  clampMicro,
  formatMicro,
  formatTime,
  glyphsForMicro,
  glyphsForTime,
  rangeLabel,
  randomDelta,
  pickSpecial,
  nextValue,
};
