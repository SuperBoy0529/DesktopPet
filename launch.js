'use strict';

/**
 * 启动器 / launcher.
 *
 * Console output here is intentionally ASCII-only: Windows consoles use a
 * legacy code page (GBK on zh-CN), and UTF-8 Chinese text turns into mojibake.
 *
 * Why a launcher at all: in some restricted process environments Chromium's
 * own sandbox cannot initialise, and Electron exits before running any JS
 * (exit code 0x80000003 / STATUS_BREAKPOINT). At that point the app has no
 * chance to log anything, so a plain `electron .` looks like "double-click
 * does nothing". We probe the default launch and fall back to --no-sandbox.
 *
 * Exit code 0 within the probe window is NOT a failure: it means another
 * instance already held the single-instance lock and brought itself to the
 * front (that is the intended behaviour of a second double-click).
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

const APP_DIR = __dirname;
const PROBE_MS = 2500;

let electronPath;
try {
  electronPath = require('electron');
} catch {
  console.error('[error] Electron runtime not found. Run: npm install');
  process.exit(1);
}

if (typeof electronPath !== 'string') {
  console.error('[error] Run this with plain Node (npm start), not inside Electron.');
  process.exit(1);
}

const passthrough = process.argv.slice(2);

function attempt(extraArgs) {
  return new Promise((resolve) => {
    const child = spawn(electronPath, [...extraArgs, APP_DIR, ...passthrough], {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.unref();
      finish({ outcome: 'running', child });
    }, PROBE_MS);

    child.on('error', (error) => finish({ outcome: 'failed', error }));
    child.on('exit', (code, signal) => finish({ outcome: 'exited', code, signal }));
  });
}

function report(result, usedNoSandbox) {
  const suffix = usedNoSandbox ? ' (Chromium sandbox disabled)' : '';
  console.log(`[ok] Divergence meter is running${suffix}.`);
  void result;
}

(async () => {
  // 1) default launch (full Chromium sandbox, preferred)
  const first = await attempt([]);

  if (first.outcome === 'running') {
    report(first, false);
    return;
  }
  if (first.outcome === 'exited' && first.code === 0) {
    console.log('[ok] Already running - the existing meter was brought to the front.');
    return;
  }

  // 2) fallback: the sandbox could not initialise in this environment
  console.warn(
    `[warn] Default launch unusable (code=${first.code ?? first.error?.code ?? 'n/a'}), ` +
      'retrying with --no-sandbox...',
  );
  const second = await attempt(['--no-sandbox']);

  if (second.outcome === 'running') {
    report(second, true);
    return;
  }
  if (second.outcome === 'exited' && second.code === 0) {
    console.log('[ok] Already running - the existing meter was brought to the front.');
    return;
  }

  console.error('[error] Startup failed.');
  console.error(`        code   : ${second.code ?? second.error?.code ?? 'n/a'}`);
  console.error(`        signal : ${second.signal ?? 'n/a'}`);
  console.error(`        binary : ${electronPath}`);
  console.error('        details: logs/app.log');
  process.exit(1);
})();
