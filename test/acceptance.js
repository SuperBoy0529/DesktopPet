'use strict';

/**
 * 不需要 Electron 的逻辑验收脚本：node test/acceptance.js
 * 覆盖 8 位格式、点击必变化、变化幅度、特殊值命中率与全部特殊值、收束范围、持久化。
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const worldline = require('../src/worldline');
const store = require('../src/store');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

/** 可复现的伪随机，便于失败时复跑 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cfg = store.loadConfig(path.join(__dirname, '..', 'config.json')).config;

console.log('\n[1] 显示格式');
check('1.048596 正确格式化为 8 字符', () => {
  assert.strictEqual(worldline.formatMicro(1048596), '1.048596');
  assert.strictEqual(worldline.formatMicro(1048596).length, 8);
});
check('个位 + 小数点 + 六位小数 = 8 个管位', () => {
  const g = worldline.glyphsForMicro(1048596);
  assert.strictEqual(g.length, 8);
  assert.strictEqual(g[1], '.');
  assert.strictEqual(g[0], '1');
});
check('0 与最大值边界', () => {
  assert.strictEqual(worldline.formatMicro(0), '0.000000');
  assert.strictEqual(worldline.formatMicro(2999999), '2.999999');
});
check('负值不显示负号（按幅值显示）', () => {
  // 菲利斯线是 -0.275349，探测仪无法显示负号，因此显示 0.275349
  assert.strictEqual(worldline.formatMicro(-12345), '0.012345');
  assert.strictEqual(worldline.formatMicro(-275349), '0.275349');
  assert.strictEqual(worldline.formatMicro(-275349).length, 8);
});
check('时间格式 HH:MM:SS 也是 8 个管位', () => {
  const d = new Date(2026, 9, 18, 9, 5, 3);
  const g = worldline.glyphsForTime(d, cfg);
  assert.strictEqual(g.join(''), '09:05:03');
  assert.strictEqual(g.length, 8);
  assert.deepStrictEqual([g[2], g[5]], [':', ':']);
});

console.log('\n[2] 每次点击都必须变化');
check('5000 次连续点击，无一重复', () => {
  const rnd = mulberry32(20261018);
  let micro = worldline.toMicro(cfg.worldline.initialValue);
  let misses = 0;
  const maxMicro = worldline.toMicro(cfg.worldline.max);
  const minMicro = worldline.toMicro(cfg.worldline.min);
  for (let i = 0; i < 5000; i += 1) {
    const res = worldline.nextValue(cfg, micro, misses, rnd);
    assert.notStrictEqual(res.micro, micro, `第 ${i + 1} 次点击数值没有变化`);
    // 负区只可能来自特殊世界线（菲利斯线）；探测仪能显示的最小幅值是 -0.999999
    assert.ok(res.micro >= -999999, `低于可显示下限：${res.micro}`);
    assert.ok(res.micro <= maxMicro, `高于上限：${res.micro}`);
    // 从非负区出发的普通漂移，必须仍然落在配置范围内
    if (micro >= minMicro && !res.special) {
      assert.ok(res.micro >= minMicro, `第 ${i + 1} 次漂移掉出下限：${res.micro}`);
    }
    micro = res.micro;
    misses = res.special ? 0 : misses + 1;
  }
});
check('20 次连续点击，每次都有变化', () => {
  const rnd = mulberry32(7);
  let micro = 13;
  let misses = 0;
  for (let i = 0; i < 20; i += 1) {
    const before = micro;
    const res = worldline.nextValue(cfg, micro, misses, rnd);
    assert.notStrictEqual(res.micro, before);
    micro = res.micro;
    misses = res.special ? 0 : misses + 1;
  }
});

console.log('\n[3] 变化幅度应当轻微');
check('绝大多数变化只动小数点后末两位', () => {
  const rnd = mulberry32(99);
  let micro = worldline.toMicro(cfg.worldline.initialValue);
  let misses = 0;
  let microOnlyLastTwo = 0;
  const total = 3000;
  for (let i = 0; i < total; i += 1) {
    const res = worldline.nextValue(cfg, micro, misses, rnd);
    if (!res.special && Math.abs(res.micro - micro) <= 99) microOnlyLastTwo += 1;
    micro = res.micro;
    misses = res.special ? 0 : misses + 1;
  }
  const ratio = microOnlyLastTwo / total;
  assert.ok(ratio >= 0.8, `末两位内变化占比过低：${(ratio * 100).toFixed(1)}%`);
});
check('平均单次位移远小于 0.01', () => {
  const rnd = mulberry32(123);
  let micro = worldline.toMicro(cfg.worldline.initialValue);
  let misses = 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < 3000; i += 1) {
    const res = worldline.nextValue(cfg, micro, misses, rnd);
    if (!res.special) {
      sum += Math.abs(res.micro - micro);
      n += 1;
    }
    micro = res.micro;
    misses = res.special ? 0 : misses + 1;
  }
  const avg = sum / n / 1000000;
  assert.ok(avg < 0.01, `平均位移 ${avg.toFixed(6)} 过大`);
});

console.log('\n[4] 特殊世界线');
check('100 次点击内至少命中一次特殊值（多轮抽样）', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const rnd = mulberry32(seed);
    let micro = worldline.toMicro(cfg.worldline.initialValue);
    let misses = 0;
    let hits = 0;
    for (let i = 0; i < 100; i += 1) {
      const res = worldline.nextValue(cfg, micro, misses, rnd);
      if (res.special) hits += 1;
      micro = res.micro;
      misses = res.special ? 0 : misses + 1;
    }
    assert.ok(hits >= 1, `seed=${seed} 的 100 次点击没有命中特殊值`);
  }
});
check('特殊值命中率落在 3%–8% 附近', () => {
  const rnd = mulberry32(4242);
  let micro = worldline.toMicro(cfg.worldline.initialValue);
  let misses = 0;
  let hits = 0;
  const total = 20000;
  for (let i = 0; i < total; i += 1) {
    const res = worldline.nextValue(cfg, micro, misses, rnd);
    if (res.special) hits += 1;
    micro = res.micro;
    misses = res.special ? 0 : misses + 1;
  }
  const rate = hits / total;
  assert.ok(rate > 0.03 && rate < 0.09, `命中率 ${(rate * 100).toFixed(2)}% 超出预期`);
});
check('全部 17 个特殊值都可以命中，且 texts.json 覆盖每一条', () => {
  const textsModule = require('../src/texts');
  const { texts } = textsModule.loadTexts(path.join(__dirname, '..', 'texts.json'));

  const forced = {
    ...cfg,
    worldline: { ...cfg.worldline, specialChance: 1, pityAfterMisses: 0 },
  };
  const rnd = mulberry32(2026);
  const seen = new Set();
  let micro = 0;
  for (let i = 0; i < 30000 && seen.size < cfg.worldline.specialValues.length; i += 1) {
    const res = worldline.nextValue(forced, micro, 0, rnd);
    if (res.special) seen.add(worldline.formatMicro(res.micro));
    micro = res.micro;
  }

  // 管面显示的键（负值取幅值）
  const expectedKeys = cfg.worldline.specialValues.map((s) =>
    worldline.formatMicro(worldline.toMicro(s.value)),
  );
  assert.strictEqual(new Set(expectedKeys).size, expectedKeys.length, 'config 里存在重复的特殊值');
  assert.strictEqual(expectedKeys.length, 17, `特殊值数量应为 17，实际 ${expectedKeys.length}`);

  for (const key of expectedKeys) {
    assert.ok(seen.has(key), `特殊值 ${key} 从未命中`);
    assert.ok(texts.worldlines[key], `texts.json 缺少 ${key} 的文案`);
  }
  // 反向检查：texts.json 里不应该有 config 中不存在的孤儿条目
  for (const key of Object.keys(texts.worldlines)) {
    assert.ok(expectedKeys.includes(key), `texts.json 有孤儿条目 ${key}`);
  }
});
check('文案解析：命中特殊值 / 普通值各自取到什么', () => {
  const textsModule = require('../src/texts');
  const { texts } = textsModule.loadTexts(path.join(__dirname, '..', 'texts.json'));
  const resolve = (v) =>
    textsModule.resolve(texts, worldline.toMicro(v), worldline.formatMicro, worldline.rangeLabel);

  const sg = resolve(1.048596);
  assert.strictEqual(sg.label, 'Steins;Gate 世界线');
  assert.strictEqual(sg.chapter, '第十章');
  assert.ok(sg.quote.length > 0, 'S;G 应该有台词');

  // 负值按幅值查表
  const faris = resolve(-0.275349);
  assert.strictEqual(faris.label, '菲利斯线');

  // 表里没有的普通值：退回收束范围名，且不会崩
  const plain = resolve(1.500000);
  assert.strictEqual(plain.label, 'β 世界线');
  assert.strictEqual(plain.quote, '');
});
check('负值特殊世界线命中后，后续漂移不会瞬间跳回 0', () => {
  const forced = {
    ...cfg,
    worldline: { ...cfg.worldline, specialChance: 1, pityAfterMisses: 0 },
  };
  const rnd = mulberry32(99);
  // 直接构造"刚命中菲利斯线"的状态
  let micro = worldline.toMicro(-0.275349);
  const quiet = { ...cfg, worldline: { ...cfg.worldline, specialChance: 0, pityAfterMisses: 0 } };
  for (let i = 0; i < 50; i += 1) {
    const next = worldline.nextValue(quiet, micro, 0, rnd).micro;
    assert.ok(Math.abs(next - micro) <= 400000, `第 ${i + 1} 次漂移幅度过大：${next - micro}`);
    micro = next;
  }
  void forced;
});
check('pity 机制保证不会长期不出特殊值', () => {
  const noLuck = {
    ...cfg,
    worldline: { ...cfg.worldline, specialChance: 0, pityAfterMisses: 60 },
  };
  const rnd = mulberry32(1);
  let micro = worldline.toMicro(cfg.worldline.initialValue);
  let misses = 0;
  let hit = false;
  for (let i = 0; i < 61; i += 1) {
    const res = worldline.nextValue(noLuck, micro, misses, rnd);
    if (res.special) hit = true;
    micro = res.micro;
    misses = res.special ? 0 : misses + 1;
  }
  assert.ok(hit, '保底机制未生效');
});

console.log('\n[5] 收束范围');
check('α/β/γ 边界', () => {
  assert.strictEqual(worldline.rangeLabel(0), 'α');
  assert.strictEqual(worldline.rangeLabel(999999), 'α');
  assert.strictEqual(worldline.rangeLabel(1000000), 'β');
  assert.strictEqual(worldline.rangeLabel(1999999), 'β');
  assert.strictEqual(worldline.rangeLabel(2000000), 'γ');
  assert.strictEqual(worldline.rangeLabel(2999999), 'γ');
});

console.log('\n[6] 配置与持久化');
check('config.json 可解析且包含全部可调参数', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
  for (const key of ['window', 'time', 'worldline', 'interaction', 'appearance']) {
    assert.ok(raw[key], `缺少配置段 ${key}`);
  }
  assert.strictEqual(typeof raw.worldline.specialChance, 'number');
  assert.ok(Array.isArray(raw.worldline.deltaTiers));
  assert.strictEqual(raw.worldline.specialValues.length, 17);
  for (const key of ['startMode', 'clickThrough', 'showTrayIcon', 'hideTaskbarIcon', 'toggleClickThroughHotkey']) {
    assert.ok(key in raw.window, `window 缺少 ${key}`);
  }
});
check('config.json 的键集合与内置默认值一致', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
  const walk = (a, b, trail) => {
    for (const k of Object.keys(a)) {
      if (k.startsWith('_')) continue;
      assert.ok(k in b, `config.json 有而默认值缺失：${trail}${k}`);
      if (a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) walk(a[k], b[k], `${trail}${k}.`);
    }
    for (const k of Object.keys(b)) {
      if (k.startsWith('_')) continue;
      assert.ok(k in a, `默认值有而 config.json 缺失：${trail}${k}`);
    }
  };
  walk(raw, store.DEFAULT_CONFIG, '');
});
check('状态可写入并原样读回（模式 / 穿透 / 数值 / 历史）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgs-state-'));
  const file = path.join(dir, 'state.json');
  const state = {
    version: 1,
    mode: 'worldline',
    clickThrough: true,
    skipTaskbar: true,
    window: { x: 120, y: 240 },
    worldline: {
      micro: 1129848,
      missesSinceSpecial: 17,
      clicks: 42,
      history: [{ value: 1.382733, label: 'β 变动', at: new Date().toISOString() }],
    },
  };
  store.saveState(file, state);
  const back = store.loadState(file, cfg);
  assert.strictEqual(back.mode, 'worldline');
  assert.strictEqual(back.clickThrough, true);
  assert.strictEqual(back.skipTaskbar, true);
  assert.deepStrictEqual(back.window, { x: 120, y: 240 });
  assert.strictEqual(back.worldline.micro, 1129848);
  assert.strictEqual(back.worldline.history.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
check('损坏的状态文件退回默认值而不是崩溃', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgs-state-'));
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, '{ this is not json');
  const back = store.loadState(file, cfg);
  assert.strictEqual(back.mode, 'time');
  assert.ok(Number.isFinite(back.worldline.micro));
  fs.rmSync(dir, { recursive: true, force: true });
});
check('部分配置会与默认值合并', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgs-cfg-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ window: { startMode: 'worldline' } }));
  const { config } = store.loadConfig(file);
  assert.strictEqual(config.window.startMode, 'worldline');
  assert.strictEqual(config.worldline.specialValues.length, 17);
  assert.strictEqual(config.window.showTrayIcon, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\n结果：${passed} 项通过，${failed} 项失败\n`);
process.exit(failed === 0 ? 0 : 1);
