'use strict';

/**
 * Dev driver: 通过 Chrome DevTools 协议驱动正在运行的桌宠。
 * 需要应用以 --remote-debugging-port=9222 启动。
 *
 *   node tools/dev/drive.js state
 *   node tools/dev/drive.js mode <time|worldline>
 *   node tools/dev/drive.js bg <none|dark|frosted|acrylic|fond>
 *   node tools/dev/drive.js clickthrough <on|off|toggle>
 *   node tools/dev/drive.js click [n]
 *   node tools/dev/drive.js menu | closemenu
 */

const PORT = Number(process.env.SGS_DEBUG_PORT || 9222);

async function connectTo(fragment) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = list.find((x) => x.type === 'page' && x.url.includes(fragment));
  if (!target) throw new Error(`no target matching ${fragment}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let id = 1;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const myId = id++;
      pending.set(myId, { res, rej });
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  await send('Runtime.enable');
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  return { evaluate, close: () => ws.close() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CLICK = `
(async () => {
  const pet = document.getElementById('pet');
  pet.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 25));
  window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true, cancelable: true }));
  return true;
})()
`;

const STATE = `JSON.stringify({
  display: document.getElementById('pet').dataset.display,
  mode: document.getElementById('pet').dataset.mode,
  bg: [...document.getElementById('pet').classList].filter(c => c.startsWith('background-')).join(','),
  brand: document.getElementById('hudStatus').textContent,
  chapter: document.getElementById('hudChapter').textContent,
  notice: document.getElementById('notice').textContent,
  quote: document.getElementById('hint').textContent,
  range: document.getElementById('rangeLabel').textContent,
  surge: document.getElementById('pet').classList.contains('surge')
})`;

(async () => {
  const [cmd, arg] = process.argv.slice(2);

  // 穿透时的"恢复把手"：连它自己的页面
  if (cmd === 'handle') {
    const h = await connectTo('handle.html');
    const rectJson = await h.evaluate(
      `JSON.stringify(document.getElementById('h').getBoundingClientRect())`,
    );
    console.log('handle rect =', rectJson);
    console.log('handleClick =', await h.evaluate(`JSON.stringify(await window.dsh.handleClick())`));
    h.close();
    return;
  }

  const pet = await connectTo('pet.html');

  if (cmd === 'mode') {
    await pet.evaluate(`window.dsh.setMode('${arg || 'worldline'}')`);
  } else if (cmd === 'bg') {
    await pet.evaluate(`window.dsh.menuAction('background:${arg || 'dark'}')`);
    await sleep(1600); // native material 会重建窗口
  } else if (cmd === 'clickthrough') {
    const want = arg || 'toggle';
    if (want === 'toggle') {
      await pet.evaluate(`window.dsh.menuAction('toggle:clickThrough')`);
    } else {
      const cur = JSON.parse(await pet.evaluate(`JSON.stringify(window.dsh.menuState())`));
      if (Boolean(cur.clickThrough) !== (want === 'on')) {
        await pet.evaluate(`window.dsh.menuAction('toggle:clickThrough')`);
      }
    }
    await sleep(400);
  } else if (cmd === 'click') {
    const n = Number(arg || 1);
    for (let i = 0; i < n; i += 1) {
      await pet.evaluate(CLICK);
      await sleep(160);
      for (let k = 0; k < 45; k += 1) {
        const s = JSON.parse(await pet.evaluate(STATE));
        if (!s.surge) break;
        await sleep(60);
      }
    }
  } else if (cmd === 'menu') {
    await pet.evaluate(`window.dsh.openMenu()`);
  } else if (cmd === 'closemenu') {
    await pet.evaluate(`window.dsh.closeMenu()`);
  } else if (cmd === 'eval') {
    // 通用求值，方便临时探查
    console.log(await pet.evaluate(arg));
    pet.close();
    return;
  }

  await sleep(250);
  console.log(await pet.evaluate(STATE));
  const app = JSON.parse(
    await pet.evaluate(`(async () => JSON.stringify(await window.dsh.menuState()))()`),
  );
  console.log(`clickThrough=${app.clickThrough} mode=${app.mode} bg=${app.background} hasTray=${app.hasTray}`);
  pet.close();
})().catch((e) => {
  console.error('DRIVE ERROR:', e.message);
  process.exit(1);
});
