'use strict';

/**
 * 真实应用的集成验收：通过 Chrome DevTools 协议驱动正在运行的桌宠窗口。
 *
 * 前置：应用已带 --remote-debugging-port=9222 启动
 * 运行：node test/integration.js
 *
 * 这里验证的是"跑起来的程序"本身：真实 DOM 事件、真实主进程逻辑、真实窗口样式。
 */

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const PORT = 9222;
const HELPER = path.join(__dirname, 'helpers', 'win.ps1');
const ROOT = path.join(__dirname, '..');

let passed = 0;
let failed = 0;

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(
      (value) => {
        passed += 1;
        console.log(`  PASS  ${name}`);
        return value;
      },
      (err) => {
        failed += 1;
        console.log(`  FAIL  ${name}\n        ${err.message}`);
        return undefined;
      },
    );
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function win32(args) {
  const out = execFileSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', HELPER, ...args],
    { encoding: 'utf8' },
  ).trim();
  return JSON.parse(out.split('\n').pop());
}

/* --------------------------------------------------------------- CDP 客户端 */

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('CDP 连接失败')), { once: true });
    });
    const cdp = new Cdp(ws);
    await cdp.send('Runtime.enable');
    return cdp;
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, 20000);
    });
  }

  /** 在页面里求值，返回 JSON 化的结果 */
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`页面异常: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description || ''}`);
    }
    return res.result.value;
  }

  close() {
    this.ws.close();
  }
}

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

async function connectTo(fragment) {
  const list = await targets();
  const target = list.find((t) => t.type === 'page' && t.url.includes(fragment));
  if (!target) throw new Error(`找不到页面：${fragment}`);
  return Cdp.connect(target.webSocketDebuggerUrl);
}

/* ------------------------------------------------------------------ 页面助手 */

const READ_GLYPHS = `document.getElementById('pet').dataset.display`;
const READ_MODE = `document.getElementById('pet').dataset.mode`;
const READ_NOTICE = `document.getElementById('notice').textContent`;
const READ_SURGE = `document.getElementById('pet').classList.contains('surge')`;

/** 一次真实的左键单击：mousedown 落在桌宠上，mouseup 落在 window 上 */
const DISPATCH_CLICK = `
(async () => {
  const pet = document.getElementById('pet');
  pet.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 25));
  window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true, cancelable: true }));
  return true;
})()
`;

async function clickOnce(pet) {
  await pet.eval(DISPATCH_CLICK);
}

/** 等数值真正发生变化（点击后的正常反应窗口） */
async function waitGlyphChange(pet, prev, timeoutMs = 2000) {
  const started = Date.now();
  let cur = prev;
  while (Date.now() - started < timeoutMs) {
    cur = await pet.eval(READ_GLYPHS);
    if (cur !== prev) return cur;
    await sleep(35);
  }
  return cur;
}

/** 等世界重构动画结束、数字稳定下来 */
async function waitSettled(pet, timeoutMs = 3000) {
  const started = Date.now();
  let last = null;
  let cur = null;
  while (Date.now() - started < timeoutMs) {
    cur = await pet.eval(READ_GLYPHS);
    const surging = await pet.eval(READ_SURGE);
    if (!surging && cur === last) return cur;
    last = cur;
    await sleep(90);
  }
  return cur;
}

/** 点击后一小段时间内是否出现过世界重构动画，并抓一帧"正在跳"的画面 */
async function pollSurge(pet, timeoutMs = 700) {
  const started = Date.now();
  let sample = null;
  while (Date.now() - started < timeoutMs) {
    const surging = await pet.eval(READ_SURGE);
    if (surging) {
      if (!sample) sample = await pet.eval(READ_GLYPHS);
      return { surged: true, sample };
    }
    await sleep(30);
  }
  return { surged: false, sample: null };
}

function toNumber(text) {
  const m = /^(\d)\.(\d{6})$/.exec(text.trim());
  if (!m) return null;
  return Number(`${m[1]}.${m[2]}`);
}

/* --------------------------------------------------------------------- 主流程 */

async function main() {
  console.log('\n[0] 连接正在运行的桌宠');
  const pet = await connectTo('pet.html');
  await check('可通过调试协议连上桌宠页面', async () => {
    const title = await pet.eval('document.title');
    assert(title.includes('世界线'), `标题异常：${title}`);
  });

  console.log('\n[1] 默认时间显示模式');
  const glyphs = await pet.eval(READ_GLYPHS);
  await check('默认模式为 time', async () => {
    assert((await pet.eval(READ_MODE)) === 'time', '默认模式不是 time');
  });
  await check('显示为 HH:MM:SS 且共 8 个管位', async () => {
    assert(/^\d{2}:\d{2}:\d{2}$/.test(glyphs), `实际显示：${glyphs}`);
    assert(glyphs.length === 8, `管位数：${glyphs.length}`);
  });
  await check('与系统时间一致（±2 秒）', async () => {
    const now = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const expect = `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`;
    const toSec = (s) => {
      const [h, m, sec] = s.split(':').map(Number);
      return h * 3600 + m * 60 + sec;
    };
    const diff = Math.abs(toSec(glyphs) - toSec(expect));
    assert(diff <= 2, `显示 ${glyphs} 与系统时间 ${expect} 相差 ${diff}s`);
  });
  await check('每秒刷新且不跳秒（高频采样真实跳变）', async () => {
    // 不能"sleep 1.05s 再读一次"：若采样点正好跨过两个秒边界，会读成 +2，
    // 那是采样混叠而不是程序跳秒。这里 60ms 轮询，捕捉每一次真实跳变。
    let prev = toSeconds(await pet.eval(READ_GLYPHS));
    const transitions = [];
    const started = Date.now();
    while (transitions.length < 3 && Date.now() - started < 6000) {
      await sleep(60);
      const cur = toSeconds(await pet.eval(READ_GLYPHS));
      if (cur === prev) continue;
      transitions.push({ delta: (cur - prev + 86400) % 86400, at: Date.now() });
      prev = cur;
    }
    assert(transitions.length >= 3, `只采到 ${transitions.length} 次跳变`);
    for (const t of transitions) {
      assert(t.delta === 1, `跳变异常 +${t.delta}s（应为 +1）`);
    }
    // 顺手验证刷新周期确实是 1 秒
    for (let i = 1; i < transitions.length; i += 1) {
      const gap = transitions[i].at - transitions[i - 1].at;
      assert(Math.abs(gap - 1000) <= 220, `刷新间隔 ${gap}ms 偏离 1000ms 过多`);
    }
  });

  console.log('\n[2] 模式切换');
  await check('切到世界线模式后立即显示 d.dddddd', async () => {
    await pet.eval(`window.dsh.setMode('worldline')`);
    await sleep(120);
    const shown = await pet.eval(READ_GLYPHS);
    assert(/^\d\.\d{6}$/.test(shown), `实际显示：${shown}`);
    assert((await pet.eval(READ_MODE)) === 'worldline', '模式未切换');
  });
  await check('切回时间模式后立即恢复时间', async () => {
    await pet.eval(`window.dsh.setMode('time')`);
    await sleep(120);
    const shown = await pet.eval(READ_GLYPHS);
    assert(/^\d{2}:\d{2}:\d{2}$/.test(shown), `实际显示：${shown}`);
    await pet.eval(`window.dsh.setMode('worldline')`);
    await sleep(120);
  });

  console.log('\n[3] 点击改变变动率（真实 DOM 事件）');
  await check('连续 20 次点击，每次数值都变化且只算一次', async () => {
    let prev = await pet.eval(READ_GLYPHS);
    for (let i = 0; i < 20; i += 1) {
      const before = (await pet.eval(`window.dsh.menuState()`)).worldline.clicks;
      await clickOnce(pet);
      const changed = await waitGlyphChange(pet, prev);
      assert(changed !== prev, `第 ${i + 1} 次点击数值没变（${changed}）`);
      const settled = await waitSettled(pet);
      assert(/^\d\.\d{6}$/.test(settled), `第 ${i + 1} 次点击显示异常：${settled}`);

      // 渲染层是串行队列：极端情况下计数的广播会晚一拍到，
      // 所以轮询到 +1 再断言，避免把"还没到"误判成"没算"。
      let after = before;
      const t0 = Date.now();
      while (Date.now() - t0 < 800) {
        after = (await pet.eval(`window.dsh.menuState()`)).worldline.clicks;
        if (after !== before) break;
        await sleep(40);
      }
      assert(after === before + 1, `第 ${i + 1} 次点击计数不是 +1：${before} -> ${after}`);
      prev = settled;
      await sleep(40);
    }
  });

  await check('变化幅度总体轻微（末两位内的占多数）', async () => {
    let prev = toNumber(await pet.eval(READ_GLYPHS));
    let small = 0;
    let total = 0;
    for (let i = 0; i < 30; i += 1) {
      await clickOnce(pet);
      const surge = await pollSurge(pet, 400);
      const settled = await waitSettled(pet);
      const cur = toNumber(settled);
      if (!surge.surged && prev !== null && cur !== null) {
        total += 1;
        if (Math.abs(cur - prev) <= 0.0001 + 1e-9) small += 1;
      }
      prev = cur;
      await sleep(30);
    }
    assert(total >= 5, '有效样本太少');
    const ratio = small / total;
    assert(ratio >= 0.6, `末两位内变化占比 ${(ratio * 100).toFixed(1)}% 偏低`);
  });

  console.log('\n[4] 特殊世界线');
  const special = await check('最多 100 次点击内命中特殊值并给出提示文本', async () => {
    let hit = null;
    for (let i = 0; i < 100 && !hit; i += 1) {
      await clickOnce(pet);
      const surge = await pollSurge(pet, 600);
      const settled = await waitSettled(pet);
      if (surge.surged) {
        const notice = await pet.eval(READ_NOTICE);
        const quote = await pet.eval(`document.getElementById('hint').textContent`);
        const quoteClass = await pet.eval(
          `document.getElementById('hint').classList.contains('special')`,
        );
        const chapter = await pet.eval(`document.getElementById('hudChapter').textContent`);
        const chapterVisible = await pet.eval(
          `document.getElementById('hudChapter').classList.contains('visible')`,
        );
        const isSpecialClass = await pet.eval(
          `document.getElementById('notice').classList.contains('special')`,
        );
        hit = { mid: surge.sample, settled, notice, quote, quoteClass, chapter, chapterVisible, isSpecialClass };
      }
      await sleep(30);
    }
    assert(hit, '100 次点击都没有命中特殊值');
    assert(/^\d\.\d{6}$/.test(hit.settled), `落定值格式异常：${hit.settled}`);
    assert(hit.mid && hit.mid !== hit.settled, '特殊值没有经历闪烁跳动的过程');
    assert(hit.notice.length > 0, '没有显示提示文本');
    assert(hit.isSpecialClass, '提示文本没有 special 样式');
    assert(hit.quote.length > 0, '第二行台词没有显示');
    assert(hit.quoteClass, '台词行没有 special 样式');
    console.log(`        命中：${hit.settled} —— ${hit.notice}`);
    console.log(`        台词：${hit.quote}`);
    if (hit.chapterVisible) console.log(`        章节：${hit.chapter}`);
    return hit;
  });

  await check('命中值属于特殊世界线表，文案来自 texts.json', async () => {
    if (!special) throw new Error('上一步未命中');
    const textsModule = require('../src/texts');
    const { texts } = textsModule.loadTexts(path.join(ROOT, 'texts.json'));
    // 负向变动率不显示负号，所以按幅值比对
    const entry = texts.worldlines[special.settled];
    assert(entry, `${special.settled} 不在 texts.json 里`);
    assert(entry.label === special.notice, `标签不符：${entry.label} vs ${special.notice}`);
    assert(entry.quote === special.quote, `台词不符：${entry.quote} vs ${special.quote}`);
    if (entry.chapter) {
      assert(entry.chapter === special.chapter, `章节不符：${entry.chapter} vs ${special.chapter}`);
    }
  });

  console.log('\n[5] 右键菜单');
  await check('右键菜单可以弹出', async () => {
    await pet.eval(`window.dsh.openMenu()`);
    await sleep(700);
    const list = await targets();
    const menu = list.find((t) => t.url.includes('menu.html'));
    assert(menu, '菜单窗口没有出现');
  });

  let menuCdp = null;
  await check('菜单含两个模式项且当前模式打勾', async () => {
    menuCdp = await connectTo('menu.html');
    const items = await menuCdp.eval(
      `[...document.querySelectorAll('.item')].map(i => ({id: i.dataset.id, checked: i.classList.contains('checked')}))`,
    );
    const ids = items.map((i) => i.id);
    assert(ids.includes('mode:time'), '缺少时间显示模式项');
    assert(ids.includes('mode:worldline'), '缺少世界线变动模式项');
    assert(ids.includes('hide:tray'), '缺少隐藏到托盘项');
    assert(ids.includes('quit'), '缺少退出项');
    assert(ids.includes('toggle:clickThrough'), '缺少点击穿透开关');
    const wl = items.find((i) => i.id === 'mode:worldline');
    assert(wl.checked, '当前模式（世界线）没有打勾');
  });

  await check('通过菜单切换回时间模式，且菜单自动关闭', async () => {
    await menuCdp.eval(`document.querySelector('[data-id="mode:time"]').click()`);
    await sleep(600);
    assert((await pet.eval(READ_MODE)) === 'time', '菜单切换模式未生效');
    const list = await targets();
    assert(!list.some((t) => t.url.includes('menu.html')), '菜单没有关闭');
  });
  menuCdp?.close();

  console.log('\n[6] 点击穿透与窗口属性');
  await check('开启点击穿透后窗口带上 WS_EX_TRANSPARENT', async () => {
    await pet.eval(`window.dsh.menuAction('toggle:clickThrough')`);
    await sleep(400);
    const info = win32(['-Action', 'info']);
    const ex = parseInt(info.exStyle, 16);
    assert((ex & 0x20) !== 0, `缺少穿透样式，exStyle=${info.exStyle}`);
  });

  await check('穿透时状态条常驻显示"怎么恢复"', async () => {
    const hint = await pet.eval(`document.getElementById('hint').textContent`);
    assert(hint.includes('穿透'), `第二行没有穿透提示：${hint}`);
    assert(/Control\+Alt\+Shift\+D/.test(hint), `提示里没有快捷键：${hint}`);
  });

  await check('穿透后按全局快捷键 Ctrl+Alt+Shift+D 能恢复互动', async () => {
    // 这是穿透状态下唯一不依赖托盘图标的逃生路径，必须真的验证
    win32(['-Action', 'hotkey']);
    await sleep(900);
    const state = await pet.eval(
      `(async () => JSON.stringify(await window.dsh.menuState()))()`,
    ).then(JSON.parse);
    assert(state.clickThrough === false, '快捷键没有关闭点击穿透');
    const info = win32(['-Action', 'info']);
    const ex = parseInt(info.exStyle, 16);
    assert((ex & 0x20) === 0, `穿透样式未清除，exStyle=${info.exStyle}`);
    const hint = await pet.eval(`document.getElementById('hint').textContent`);
    assert(!hint.includes('穿透'), `恢复后提示没有消失：${hint}`);
  });

  await check('托盘始终存在（穿透时的保底入口）', async () => {
    const state = await pet.eval(
      `(async () => JSON.stringify(await window.dsh.menuState()))()`,
    ).then(JSON.parse);
    assert(state.hasTray === true, '没有托盘图标');
  });

  console.log('\n[7] 拖拽不触发变动率');
  await check('拖拽会移动窗口且不改变数值', async () => {
    const before = win32(['-Action', 'info']);
    const valueBefore = await pet.eval(READ_GLYPHS);

    await pet.eval(`window.dsh.setMode('worldline')`);
    await sleep(150);
    const wlBefore = await pet.eval(READ_GLYPHS);

    await pet.eval(`window.dsh.pointerDown()`);
    win32(['-Action', 'move', '-X', String(before.x + 40), '-Y', String(before.y + 30)]);
    await sleep(120);
    win32(['-Action', 'move', '-X', String(before.x + 90), '-Y', String(before.y + 60)]);
    await sleep(160);
    const up = await pet.eval(`window.dsh.pointerUp()`);
    await sleep(150);

    const after = win32(['-Action', 'info']);
    const wlAfter = await pet.eval(READ_GLYPHS);

    assert(up.dragged === true, '没有被判定为拖拽');
    assert(
      Math.abs(after.x - before.x) > 20 || Math.abs(after.y - before.y) > 20,
      `窗口没有移动：${before.x},${before.y} -> ${after.x},${after.y}`,
    );
    assert(wlAfter === wlBefore, `拖拽改变了变动率：${wlBefore} -> ${wlAfter}`);
    void valueBefore;
  });

  await check('原地按下抬起仍被判定为点击', async () => {
    // 先显式把光标放到窗口中心再按下：否则会受上一个拖拽测试留下的光标位置影响
    const box = win32(['-Action', 'info']);
    win32(['-Action', 'move', '-X', String(box.x + Math.round(box.w / 2)), '-Y', String(box.y + Math.round(box.h / 2))]);
    await sleep(120);
    const up = await pet.eval(
      `(async () => { await window.dsh.pointerDown(); await new Promise(r => setTimeout(r, 160)); return await window.dsh.pointerUp(); })()`,
    );
    assert(up.dragged === false, '原地点击被误判为拖拽');
  });

  console.log('\n[8] 隐藏任务栏图标后仍保留入口');
  await check('隐藏任务栏图标后托盘仍然存在', async () => {
    await pet.eval(`window.dsh.menuAction('toggle:skipTaskbar')`);
    await sleep(400);
    const state = await pet.eval(`window.dsh.menuState()`);
    assert(state.skipTaskbar === true, '未记为隐藏任务栏图标');
    assert(state.hasTray === true, '托盘入口不存在，用户将无法找回菜单');
  });
  await check('恢复任务栏图标', async () => {
    await pet.eval(`window.dsh.menuAction('toggle:skipTaskbar')`);
    await sleep(400);
    const state = await pet.eval(`window.dsh.menuState()`);
    assert(state.skipTaskbar === false, '未能恢复');
  });

  console.log('\n[9] 状态持久化');
  await check('模式与数值已写入 state/state.json', async () => {
    await pet.eval(`window.dsh.setMode('worldline')`);
    await sleep(600);
    const file = path.join(ROOT, 'state', 'state.json');
    assert(fs.existsSync(file), 'state.json 不存在');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert(saved.mode === 'worldline', `mode 未持久化：${saved.mode}`);
    assert(typeof saved.clickThrough === 'boolean', 'clickThrough 未持久化');
    assert(Number.isFinite(saved.worldline.micro), '变动率未持久化');
    assert(Array.isArray(saved.worldline.history), '特殊值历史未持久化');
  });

  await check('收尾：恢复到时间模式', async () => {
    await pet.eval(`window.dsh.setMode('time')`);
    await sleep(300);
    assert((await pet.eval(READ_MODE)) === 'time', '收尾失败');
  });

  pet.close();
  console.log(`\n结果：${passed} 项通过，${failed} 项失败\n`);
  process.exit(failed === 0 ? 0 : 1);
}

function toSeconds(text) {
  const [h, m, s] = text.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

main().catch((err) => {
  console.error('集成测试异常终止：', err.message);
  process.exit(1);
});
