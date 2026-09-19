/* `npm run play` / start.bat: one-click launcher. Starts the static server and
   LAN relay, opens the default browser, falls back to the next port when 3100
   is busy, and exits automatically once all game pages have been closed.
   Type `stop` + Enter in this window to close the server manually. */
import os from 'node:os';
import { execFile } from 'node:child_process';
import { createStaticServer } from './static-server.mjs';

let lastPing = Date.now();
const server = createStaticServer({
  // Open pages ping /__ping every 15s (background tabs are throttled to
  // ~1/min, so the grace below stays well above one minute).
  onPing: () => { lastPing = Date.now(); },
});
server.on('error', err => {
  if (err.code !== 'EADDRINUSE') { console.error(err.message); process.exitCode = 1; }
});

function listen(port) {
  return new Promise((resolve, reject) => {
    const onError = err => { server.removeListener('listening', onListening); reject(err); };
    const onListening = () => { server.removeListener('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '0.0.0.0');
  });
}

let port = 3100;
for (; port < 3120; port++) {
  try { await listen(port); break; } catch (err) { if (err.code !== 'EADDRINUSE') throw err; }
}
if (port >= 3120) throw new Error('3100-3119 端口均被占用，请先关闭其他游戏服务器进程。');
if (port !== 3100) console.log('端口 3100 已被占用，改用端口 ' + port + '。');

const localUrl = `http://127.0.0.1:${port}/`;
console.log('抽象大乱斗已启动：' + localUrl);
const lan = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => `http://${a.address}:${port}/`);
if (lan.length) console.log('局域网联机地址：\n  ' + lan.join('\n  ') + '\n两台机器都打开上面的局域网地址即可联机。');
console.log('首次运行请允许防火墙放行。关闭所有游戏页面后本进程会自动退出；也可以在本窗口输入 stop 并回车手动关闭。');

if (process.env.AB_NO_BROWSER) console.log('（AB_NO_BROWSER：不自动打开浏览器）');
else {
  const openCommand = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', localUrl]]
    : process.platform === 'darwin' ? ['open', [localUrl]] : ['xdg-open', [localUrl]];
  execFile(openCommand[0], openCommand[1], err => { if (err) console.log('浏览器打开失败，请手动访问 ' + localUrl); });
}

/* Exit when the last page closes. Idle keep-alive sockets drop on their own
   while a page is still open, so the page heartbeat is the real liveness
   signal: no ping for 90s AND no open connection means every page is gone. */
const IDLE_EXIT_MS = Number(process.env.AB_IDLE_EXIT_MS) || 90000;
setInterval(() => {
  server.getConnections((err, count) => {
    if (err || count > 0) return;
    if (Date.now() - lastPing > IDLE_EXIT_MS) {
      console.log('所有页面已关闭，服务器自动退出。');
      process.exit(0);
    }
  });
}, 10000);

/* Manual shutdown: type `stop` + Enter in this window. */
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  const text = String(chunk).trim().toLowerCase();
  if (['stop', 'exit', 'quit'].includes(text)) {
    console.log('收到停止命令，服务器退出。');
    process.exit(0);
  }
});
process.stdin.resume();
