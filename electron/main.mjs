// electron/main.mjs — SiliconStream 桌面壳
// 架构：主进程内嵌启动 server/productionServer.js（dist 静态 + 全量 API），
//       BrowserWindow 以无边框 + 系统悬浮按钮（titleBarOverlay）承载，启动即最大化。
// 开发：electron . --dev  → 直接加载 vite dev server (localhost:5175)，不内嵌服务。
import { app, BrowserWindow, Menu, dialog, ipcMain, Tray } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const IS_DEV = process.argv.includes('--dev');

/* ---- 日志：桌面启动时终端不可见，关键事件落盘项目根 electron-main.log ---- */
const LOG_FILE = path.join(ROOT, 'electron-main.log');
function appendLog(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}` + '\n');
  } catch { /* 日志失败不影响主流程 */ }
}
process.on('uncaughtException', (err) => appendLog(`[uncaught] ${err && err.stack || err}`));
process.on('unhandledRejection', (err) => appendLog(`[unhandled-rejection] ${err && err.stack || err}`));

/* ---- 关闭行为：ask（弹窗询问，默认）/ exit（直接退出）/ tray（挂后台）；持久化 userData ---- */
let closeBehavior = 'ask';
let closeAskPending = false;
let quitting = false;
const closeBehaviorFile = () => path.join(app.getPath('userData'), 'close-behavior.json');
function loadCloseBehavior() {
  try {
    const raw = JSON.parse(fs.readFileSync(closeBehaviorFile(), 'utf8'));
    if (['ask', 'exit', 'tray'].includes(raw.closeBehavior)) closeBehavior = raw.closeBehavior;
  } catch { /* 首次无文件，用默认 ask */ }
}
function saveCloseBehavior() {
  try {
    fs.mkdirSync(path.dirname(closeBehaviorFile()), { recursive: true });
    fs.writeFileSync(closeBehaviorFile(), JSON.stringify({ closeBehavior }, null, 2));
  } catch (err) { appendLog(`[close-behavior] save failed: ${err && err.message}`); }
}
function showMainWindow() {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function setupTray() {
  const iconFile = path.join(ROOT, 'build', 'icon-tray.png');
  if (!fs.existsSync(iconFile)) { appendLog('[tray] icon-tray.png missing, tray disabled'); return; }
  const tray = new Tray(iconFile);
  tray.setToolTip('SiliconStream 万般硅川');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 SiliconStream', click: () => showMainWindow() },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => showMainWindow());
  appendLog('[tray] created');
}

/* ---- .env 加载（桌面环境无 shell 注入，手动解析；不覆盖已有环境变量） ---- */
(function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = (m[2] || '').trim().replace(/^["']|["']$/g, '');
    }
  }
})();

/* ---- 技能根目录：dev 用项目根 skills/；打包用 resources/skills（extraResources，可写） ---- */
process.env.SKILLS_ROOT = IS_DEV
  ? path.join(ROOT, 'skills')
  : path.join(path.dirname(ROOT), 'skills');

/* ---- 空闲端口探测（从 3777 起递增） ---- */
function getFreePort(start) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(getFreePort(start + 1)));
    srv.listen(start, '127.0.0.1', () => srv.close(() => resolve(start)));
  });
}

/* ---- 等待内嵌服务就绪（用 /health 健康快照探测） ---- */
async function waitForServer(url, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`embedded server not ready within ${timeoutMs}ms: ${url}`);
}

/* ---- 内嵌生产服务：动态 import 前必须先定好 env（productionServer 读取时机在 import 时） ---- */
let EMBED_URL = null;
async function ensureEmbeddedServer() {
  if (EMBED_URL) return EMBED_URL;
  const port = await getFreePort(3777);
  process.env.PORT = String(port);
  // 只监听回环地址：桌面应用无需对外暴露，也避免 Windows 防火墙弹窗
  process.env.SERVER_HOST = '127.0.0.1';
  appendLog(`[embedded] importing productionServer (port ${port}) ...`);
  // Windows 绝对路径不能直接 import（'e:' 会被当 URL 协议），必须转 file:// URL
  await import(pathToFileURL(path.join(ROOT, 'server/productionServer.js')).href); // 自执行 listen
  appendLog('[embedded] module loaded, waiting for /health ...');
  await waitForServer(`http://127.0.0.1:${port}/health`);
  EMBED_URL = `http://127.0.0.1:${port}`;
  appendLog(`[embedded] ready at ${EMBED_URL}`);
  return EMBED_URL;
}

/* ---- 启动 URL 决策：dev 优先等 8s，未启动则降级内嵌 dist —— 保证永不黑屏 ---- */
async function resolveStartupUrl() {
  if (IS_DEV) {
    appendLog('[startup] --dev: waiting for vite dev server (http://localhost:5175) up to 8s ...');
    try {
      await waitForServer('http://localhost:5175', 8000);
      appendLog('[startup] dev server ready');
      return 'http://localhost:5175';
    } catch {
      appendLog('[startup] dev server NOT running → fallback to embedded dist');
    }
  } else {
    appendLog('[startup] production mode: embedding server ...');
  }
  return ensureEmbeddedServer();
}

/* ---- 窗口：无边框 + 系统悬浮按钮 + 顶部拖拽条 + 启动最大化 ---- */
function createWindow(loadUrl) {
  const win = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#16181d',
    titleBarStyle: 'hidden',
    // 右上角窗口控制按钮改由 React 组件 WindowControls 自绘（hover 淡入、随主题变色，
    // 详见 electron/preload.cjs 与 src/components/WindowControls.jsx），不再用系统 overlay。
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    show: false,
    ...(fs.existsSync(path.join(ROOT, 'build', 'icon.ico'))
      ? { icon: path.join(ROOT, 'build', 'icon.ico') }
      : {}),
  });

  // 最大化状态广播（自绘按钮切换 还原/最大化 图标；F11 全屏不影响 maximize 状态）
  const sendMaxState = () => { if (!win.isDestroyed()) win.webContents.send('window:maximize-state', win.isMaximized()); };
  win.on('maximize', sendMaxState);
  win.on('unmaximize', sendMaxState);
  // 关闭拦截：exit 放行 / tray 隐藏到托盘 / ask 弹渲染层对话框（渲染层无响应时二次点击强制退出）
  win.on('close', (e) => {
    if (quitting || closeBehavior === 'exit') return;
    e.preventDefault();
    if (closeBehavior === 'tray') { win.hide(); return; }
    if (closeAskPending) { quitting = true; app.quit(); return; }
    closeAskPending = true;
    win.webContents.send('close-requested');
  });
  win.once('ready-to-show', () => win.maximize()); // 启动即最大化（全屏观感，保留任务栏）
  win.setMenuBarVisibility(false);
  win.autoHideMenuBar = true;

  // F11 切换真全屏
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });

  // 外链一律走系统浏览器，不在应用内开新窗
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      import('node:child_process').then(({ exec }) => exec(`start "" "${url}"`)).catch(() => {});
    }
    return { action: 'deny' };
  });

  // 顶部细拖拽条：无边框后窗口拖动靠它；10px 高度不遮挡页面交互
  const injectDragBar = () => {
    win.webContents.insertCSS(`
      #electron-drag-bar { position: fixed; top: 0; left: 0; right: 0; height: 10px;
        -webkit-app-region: drag; z-index: 2147483647; }
    `).catch(() => {});
    win.webContents.executeJavaScript(`
      if (!document.getElementById('electron-drag-bar')) {
        const bar = document.createElement('div');
        bar.id = 'electron-drag-bar';
        document.body.appendChild(bar);
      }
    `).catch(() => {});
  };
  win.webContents.on('did-finish-load', injectDragBar);

  // 可观测性：主框架加载失败显示错误页（绝不黑屏），渲染层异常全部落盘
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    appendLog(`[load-fail] code=${code} desc=${desc} url=${url}`);
    const page = 'data:text/html;charset=utf-8,' + encodeURIComponent(
      `<!doctype html><html><head><meta charset='utf-8'><style>`
      + `body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0d0f14;color:#c8cdd8;font-family:'Segoe UI','Microsoft YaHei',sans-serif}`
      + `.card{max-width:560px;padding:36px 44px;border:1px solid rgba(79,227,255,.25);border-radius:14px;background:rgba(79,227,255,.04)}`
      + `h1{font-size:18px;color:#4fe3ff;margin:0 0 14px}`
      + `p{font-size:13px;line-height:1.9;margin:4px 0;color:#9aa1b0}`
      + `code{color:#e8eaf0;font-size:12px;word-break:break-all}`
      + `</style></head><body><div class='card'>`
      + `<h1>页面加载失败</h1>`
      + `<p>错误码 <code>${esc(code)}</code>：${esc(desc)}</p>`
      + `<p>目标地址：<code>${esc(url)}</code></p>`
      + `<p>完整日志见项目根目录 <code>electron-main.log</code></p>`
      + `</div></body></html>`,
    );
    win.loadURL(page).catch((err) => appendLog(`[load-fail] error page failed: ${err && err.message}`));
  });
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) appendLog(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    appendLog(`[renderer-gone] ${JSON.stringify(details)}`);
  });
  app.on('child-process-gone', (_e, details) => {
    appendLog(`[child-gone] ${JSON.stringify(details)}`);
  });

  win.loadURL(loadUrl).catch((err) => appendLog(`[loadURL] rejected: ${err && err.message}`));
  return win;
}

/* ---- 窗口控制 IPC：自绘右上角按钮（替代系统 titleBarOverlay，避免黑块挡内容） ---- */
ipcMain.on('window:minimize', () => BrowserWindow.getAllWindows()[0]?.minimize());
ipcMain.on('window:toggleMaximize', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
});
ipcMain.on('window:close', () => BrowserWindow.getAllWindows()[0]?.close());
ipcMain.handle('window:isMaximized', () => BrowserWindow.getAllWindows()[0]?.isMaximized() ?? false);
ipcMain.handle('close-behavior:get', () => closeBehavior);
ipcMain.on('close-behavior:set', (_e, behavior) => {
  if (!['ask', 'exit', 'tray'].includes(behavior)) return;
  closeBehavior = behavior;
  saveCloseBehavior();
});
ipcMain.on('close:confirm', (_e, payload) => {
  closeAskPending = false;
  const win = BrowserWindow.getAllWindows()[0];
  const action = payload && payload.action;
  const remember = !!(payload && payload.remember);
  if ((action === 'exit' || action === 'tray') && remember) { closeBehavior = action; saveCloseBehavior(); }
  if (action === 'exit') { quitting = true; app.quit(); }
  else if (action === 'tray' && win) win.hide();
});

/* ---- 单例锁：二次启动唤起已有窗口，避免端口抢占 ---- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  Menu.setApplicationMenu(null); // 去掉 Electron 默认菜单栏

  app.whenReady().then(async () => {
    try {
      appendLog(`[startup] booting (dev=${IS_DEV}, electron=${process.versions.electron}) ...`);
      loadCloseBehavior();
      const url = await resolveStartupUrl();
      appendLog(`[startup] creating window → ${url}`);
      createWindow(url);
      setupTray();
    } catch (err) {
      appendLog(`[fatal] ${err && err.stack || err}`);
      dialog.showErrorBox('SiliconStream 启动失败', String(err?.stack || err));
      app.quit();
    }
  });

  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => app.quit());
}
