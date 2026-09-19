/* `npm run dev`: static server + LAN relay, stays up until Ctrl+C.
   For a one-click launcher that opens the browser and exits when the last
   page closes, use `npm run play` or start.bat instead. */
import os from 'node:os';
import { createStaticServer } from './static-server.mjs';
const args = process.argv.slice(2), at = args.indexOf('--port');
const port = at < 0 ? 3100 : Number(args[at + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be between 1024 and 65535.');
const server = createStaticServer();
server.on('error', err => { console.error(err.message); process.exitCode = 1; });
server.listen(port, '0.0.0.0', () => {
  console.log(`抽象大乱斗：http://127.0.0.1:${port}/`);
  const lan = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => `http://${a.address}:${port}/`);
  if (lan.length) console.log(`局域网联机：${lan.join('  ')}\n两台机器都打开上面的局域网地址即可联机。首次运行请允许防火墙放行。`);
});
