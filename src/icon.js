'use strict';

/**
 * 托盘图标。
 *
 * 优先加载 src/assets/tray-16.png / tray-32.png（由 tools/make-icon.ps1 生成）。
 * 之前用 nativeImage.createFromBitmap 手工拼 BGRA 缓冲区，实测有两个坑：
 *   1. 通道顺序容易写反（琥珀色渲染成了蓝色）；
 *   2. 在 Windows 上做出来的图标可能根本不显示（托盘里找不到）。
 * 换成真实 PNG 文件后这两个问题都不存在，程序化绘制只作为兜底保留。
 */

const fs = require('node:fs');
const path = require('node:path');
const { nativeImage } = require('electron');

const ASSET_DIR = path.join(__dirname, 'assets');

function loadPng(size) {
  const file = path.join(ASSET_DIR, `tray-${size}.png`);
  try {
    if (!fs.existsSync(file)) return null;
    const img = nativeImage.createFromPath(file);
    if (!img || img.isEmpty()) return null;
    return img;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------- 程序化兜底 ---- */

function createBitmap(size) {
  const SS = 4; // 4x4 超采样抗锯齿
  const buf = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const R = size * 0.46;
  const coreR = R * 0.34;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accA = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = x + (sx + 0.5) / SS - 0.5;
          const py = y + (sy + 0.5) / SS - 0.5;
          const dx = px - c;
          const dy = py - c;
          const d = Math.sqrt(dx * dx + dy * dy);
          const rr = d / R;

          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;

          if (rr <= 1) {
            const base = 0.92 - 0.18 * rr;
            r = 30 * base;
            g = 19 * base;
            b = 12 * base;
            a = 0.96;

            if (rr > 0.8) {
              const k = 1 - Math.min(1, (rr - 0.8) / 0.2);
              r += (255 - r) * k * 0.95;
              g += (157 - g) * k * 0.95;
              b += (51 - b) * k * 0.95;
            }

            const cd = d / (R * coreR);
            if (cd < 2.4) {
              const glow = Math.max(0, 1 - cd / 2.4) ** 2;
              r += (255 - r) * glow;
              g += (190 - g) * glow;
              b += (110 - b) * glow;
            }
          }

          accR += r;
          accG += g;
          accB += b;
          accA += a;
        }
      }

      const n = SS * SS;
      const i = (y * size + x) * 4;
      const alpha = accA / n;
      // 通道顺序：实测 createFromBitmap 走 RGBA（按 BGRA 写会红蓝互换）
      buf[i] = Math.round(Math.min(255, accR / n) * alpha);
      buf[i + 1] = Math.round(Math.min(255, accG / n) * alpha);
      buf[i + 2] = Math.round(Math.min(255, accB / n) * alpha);
      buf[i + 3] = Math.round(Math.min(255, accA / n) * 255);
    }
  }

  return buf;
}

function createFallbackIcon(size) {
  const s = Math.max(16, Math.round(size));
  return nativeImage.createFromBitmap(createBitmap(s), { width: s, height: s, scaleFactor: 1 });
}

/* ------------------------------------------------------------------------ */

/** @param {number} size 期望边长（16 用于托盘，32 用于窗口） */
function createIcon(size = 16) {
  const target = Math.max(16, Math.round(size));
  const png = loadPng(target) || loadPng(target === 16 ? 32 : 16);
  if (png) {
    const got = png.getSize();
    if (got.width === target && got.height === target) return png;
    return png.resize({ width: target, height: target });
  }
  return createFallbackIcon(target);
}

/** 诊断用：告诉调用方图标到底有没有像素 */
function describeIcon(img) {
  try {
    return { size: img.getSize(), empty: img.isEmpty() };
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = { createIcon, describeIcon };
