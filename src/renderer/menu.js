'use strict';

const el = {};
let state = null;
let rows = [];

function buildRows(snapshot) {
  const bg = snapshot.background || 'dark';
  return [
    { kind: 'item', id: 'mode:time', label: '时间显示模式', radio: true, checked: snapshot.mode === 'time' },
    { kind: 'item', id: 'mode:worldline', label: '世界线变动模式', radio: true, checked: snapshot.mode === 'worldline' },
    { kind: 'sep' },
    { kind: 'label', text: '背景材质' },
    { kind: 'item', id: 'background:none', label: '透明', radio: true, checked: bg === 'none' },
    { kind: 'item', id: 'background:dark', label: '深色玻璃', radio: true, checked: bg === 'dark' },
    { kind: 'item', id: 'background:frosted', label: '磨砂毛玻璃', radio: true, checked: bg === 'frosted' },
    { kind: 'item', id: 'background:acrylic', label: '系统亚克力', radio: true, checked: bg === 'acrylic' },
    { kind: 'item', id: 'background:fond', label: 'fond 背板', radio: true, checked: bg === 'fond' },
    { kind: 'sep' },
    { kind: 'item', id: 'toggle:clickThrough', label: '点击穿透', value: snapshot.clickThrough ? '开' : '关', checked: snapshot.clickThrough },
    { kind: 'item', id: 'toggle:skipTaskbar', label: '隐藏任务栏图标', value: snapshot.skipTaskbar ? '开' : '关', checked: snapshot.skipTaskbar },
    { kind: 'sep' },
    { kind: 'item', id: 'show:pet', label: '唤出探测仪' },
    {
      kind: 'item',
      id: 'hide:tray',
      label: '隐藏窗口',
      value: snapshot.showHideHotkeyRegistered ? snapshot.showHideHotkey : '无快捷键',
    },
    { kind: 'sep' },
    { kind: 'item', id: 'quit', label: '退出', danger: true, icon: '../assets/croix.png' },
  ];
}

function render(snapshot) {
  state = snapshot;
  const defs = buildRows(snapshot);
  el.items.textContent = '';
  rows = [];

  for (const def of defs) {
    if (def.kind === 'sep') {
      const sep = document.createElement('div');
      sep.className = 'sep';
      el.items.append(sep);
      continue;
    }

    if (def.kind === 'label') {
      const group = document.createElement('div');
      group.className = 'menu-group';
      group.textContent = def.text;
      el.items.append(group);
      continue;
    }

    const row = document.createElement('div');
    row.className = 'item';
    if (def.checked) row.classList.add('checked');
    if (def.danger) row.classList.add('danger');
    row.setAttribute('role', 'menuitem');
    row.dataset.id = def.id;
    row.tabIndex = -1;

    const mark = document.createElement('span');
    mark.className = 'mark';
    // 模式项：对勾；开关项：实心/空心方块；普通项：不留符号（保留占位以对齐文字）
    if (def.radio) {
      mark.textContent = def.checked ? '✓' : '';
    } else if (def.value !== undefined) {
      mark.textContent = def.checked ? '▪' : '·';
    } else {
      mark.textContent = '';
    }

    if (def.icon) {
      const icon = document.createElement('img');
      icon.className = 'item-icon';
      icon.src = def.icon;
      icon.alt = '';
      icon.draggable = false;
      mark.append(icon);
    }

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = def.label;

    row.append(mark, label);

    if (def.value !== undefined) {
      const value = document.createElement('span');
      value.className = 'value';
      value.textContent = def.value;
      row.append(value);
    }

    row.addEventListener('click', () => activate(def.id));
    el.items.append(row);
    rows.push(row);
  }

  const foot = document.createElement('div');
  foot.className = 'foot';
  foot.textContent = snapshot.hotkeyRegistered
    ? `PASS-THROUGH · ${snapshot.hotkey}`
    : 'PASS-THROUGH · HOTKEY UNAVAILABLE';
  el.items.append(foot);

  reportSize();
}

async function activate(id) {
  await window.dsh.menuAction(id);
}

function reportSize() {
  const rect = el.menu.getBoundingClientRect();
  window.dsh.reportMenuSize({ w: Math.ceil(rect.width), h: Math.ceil(rect.height) });
}

function moveFocus(delta) {
  if (!rows.length) return;
  const current = rows.indexOf(document.activeElement);
  const next = (current + delta + rows.length) % rows.length;
  rows[next].focus();
}

async function boot() {
  el.menu = document.getElementById('menu');
  el.items = document.getElementById('items');

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      window.dsh.closeMenu();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === 'Enter' && document.activeElement?.dataset?.id) {
      activate(document.activeElement.dataset.id);
    }
  });

  const snapshot = await window.dsh.menuState();
  render(snapshot);

  window.dsh.onState((next) => {
    if (next) render(next);
  });

  // 字体就绪后再校准一次尺寸，避免菜单高度差一两个像素
  document.fonts.ready.then(reportSize).catch(() => {});
  setTimeout(reportSize, 120);
}

boot().catch((err) => {
  document.body.textContent = `菜单加载失败：${err.message}`;
});
