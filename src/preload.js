'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 唯一的渲染层 ⇄ 主进程桥。contextIsolation 开启，渲染层拿不到 Node。
 */
contextBridge.exposeInMainWorld('dsh', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  reportSize: (size) => ipcRenderer.invoke('pet:size', size),
  pointerDown: () => ipcRenderer.invoke('window:pointerDown'),
  pointerUp: () => ipcRenderer.invoke('window:pointerUp'),
  click: () => ipcRenderer.invoke('pet:click'),
  setMode: (mode) => ipcRenderer.invoke('app:setMode', mode),
  openMenu: () => ipcRenderer.invoke('menu:open'),
  closeMenu: () => ipcRenderer.invoke('menu:close'),
  menuState: () => ipcRenderer.invoke('menu:state'),
  menuAction: (action) => ipcRenderer.invoke('menu:action', action),
  reportMenuSize: (size) => ipcRenderer.send('menu:size', size),
  // 穿透时浮出的小把手：点一下就恢复互动
  handleClick: () => ipcRenderer.invoke('handle:click'),
  onState: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('app:state', listener);
    return () => ipcRenderer.removeListener('app:state', listener);
  },
  onPulse: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('app:pulse', listener);
    return () => ipcRenderer.removeListener('app:pulse', listener);
  },
});
