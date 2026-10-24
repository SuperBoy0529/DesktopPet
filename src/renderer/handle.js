'use strict';

// 穿透时浮出的小把手：唯一一个"永远点得动"的入口。
const h = document.getElementById('h');

h.addEventListener('mousedown', (e) => {
  e.preventDefault();
  window.dsh.handleClick();
});

// 兜底：某些环境下 mousedown 会被合成事件吃掉
h.addEventListener('click', () => {
  window.dsh.handleClick();
});
