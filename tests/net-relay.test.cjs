/* End-to-end LAN play: two real NetClient instances (in isolated vm contexts,
   one per machine) exchange the full protocol through the real relay — lobby,
   lockstep hashes, then a guest crash, rejoin and snapshot resume. */
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const { pathToFileURL } = require('url');
const root = path.resolve(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let checks = 0; function ok(test, msg) { checks++; assert(test, msg); }

function makeContext(port) {
  const c = { console };
  c.window = c;
  vm.createContext(c);
  for (const f of ['assets', 'roster', 'meme-roster', 'roster-revision3', 'meme-art', 'meme-visuals', 'meme-combat', 'animation-player', 'engine', 'net'])
    vm.runInContext(fs.readFileSync(path.join(root, f + '.js'), 'utf8'), c);
  // Browser globals net.js touches at runtime (no ui.js here; launchNetGame is
  // a minimal stub that builds the FightGame without DOM or asset loading).
  c.WebSocket = WebSocket;
  c.URLSearchParams = URLSearchParams;
  c.URL = URL;
  c.setTimeout = setTimeout; c.clearTimeout = clearTimeout;
  c.setInterval = setInterval; c.clearInterval = clearInterval;
  c.location = { protocol: 'http:', host: '127.0.0.1:' + port, search: '' };
  c.sessionStorage = { getItem: () => null, setItem() { }, removeItem() { } };
  const el = () => ({ textContent: '', className: '', hidden: false, disabled: false, title: '', innerHTML: '', value: '', focus() { }, click() { } });
  c.document = { getElementById: () => el() };
  vm.runInContext(`
    var currentGame=null;
    var selected=[1,3];
    function refresh(){}
    function syncMusic(){}
    function goBack(){}
    var stagePicker={choose:()=>({id:'arcade',file:''})};
    var ensureCharacter=async()=>{};
    var loadImage=async()=>({});
    function launchNetGame(fighterIndices,stageId,extra){
      const chars=fighterIndices.map(i=>ROSTER[i]);
      const game=new FightGame(null,chars,{mode:'net',stage:{id:stageId,color:'#fff',shade:'#00000020'},...extra,audio:{play(){}}});
      currentGame=game;
      return Promise.resolve(game);
    }
  `, c);
  return c;
}

(async () => {
  const { createRelayServer } = await import(pathToFileURL(path.join(root, 'scripts', 'ws-relay.mjs')));
  const relay = createRelayServer({ port: 0, slotTakeoverMs: 400 }); // fast stale-slot takeover for the zombie scenario
  await new Promise(res => relay.server.once('listening', res));
  const port = relay.server.address().port;

  const host = makeContext(port), guest = makeContext(port);
  vm.runInContext('var netHost=new NetClient();netHost.createRoom();', host);
  const room = host.netHost.room;
  vm.runInContext(`var netGuest=new NetClient();netGuest.joinRoom('${room}');`, guest);

  // Wait for the lobby handshake (hello exchanged both ways).
  for (let i = 0; i < 200 && !(host.netHost.connected && guest.netGuest.connected); i++) await sleep(10);
  ok(host.netHost.connected && guest.netGuest.connected, 'lobby handshake completes');

  // Both press 开打: the guest preloads and signals ready, the host waits.
  vm.runInContext('netGuest.startClicked();', guest);
  vm.runInContext('netHost.startClicked();', host);
  for (let i = 0; i < 300 && !(host.currentGame && guest.currentGame); i++) await sleep(10);
  ok(!!host.currentGame && !!guest.currentGame, 'go message built the match on both machines');
  ok(host.currentGame.mode === 'net' && guest.currentGame.mode === 'net', 'both games run in net mode');

  // Guest rAF-like pump; the host clock loop drives the rest.
  let running = true;
  const guestLoop = (async () => {
    while (running) {
      const g = guest.currentGame;
      if (g) for (let s = 0; s < 4 && g.netCanStep(); s++) g.step(1 / 120);
      await sleep(4);
    }
  })();

  const hostGame = host.currentGame, guestGame = guest.currentGame;
  const press = (game, code, at) => { if (game.stepNum === at) game.keyDown(code); else if (game.stepNum === at + 1) game.keyUp(code); };
  const walkPlan = [[290, 'KeyD'], [310, 'ArrowLeft'], [420, 'KeyD'], [424, 'KeyJ']];
  const guestPlan = [[305, 'ArrowLeft'], [415, 'ArrowLeft'], [428, 'Numpad1']];
  while (hostGame.stepNum < 650) {
    if (hostGame.netReady()) hostGame.step(1 / 120);
    const f = hostGame.stepNum;
    if (walkPlan.some(p => p[0] === f)) { const [at, code] = walkPlan.find(p => p[0] === f); hostGame.keyDown(code); if (code === 'KeyJ') hostGame.keyUp(code); }
    for (const [at, code] of guestPlan) { const g = guestGame.stepNum; if (g === at) guestGame.keyDown(code); if (g === at + 120) guestGame.keyUp(code); }
    await sleep(2);
  }
  running = false;
  await guestLoop;
  ok(hostGame.stepNum === 650, 'host stepped 650');
  ok(guestGame.stepNum > 620, 'guest kept up with the clock (' + guestGame.stepNum + ')');
  // Every 24 steps the guest reported a hash and the host compared it against
  // its own — any mismatch would have aborted the connection.
  ok(host.netHost.hashes.size >= 20, 'hash cross-checks ran during the match (' + host.netHost.hashes.size + ')');
  ok(host.netHost.connected && guest.netGuest.connected, 'no desync aborted the match');

  /* ---- crash the guest page, rejoin from a fresh context, resume ---- */
  const snapStep = hostGame.stepNum;
  guest.netGuest.ws.close(); // simulated crash (unexpected close)
  for (let i = 0; i < 200 && host.netHost.peerOnline; i++) await sleep(10);
  ok(!host.netHost.peerOnline, 'host noticed the guest dropped');

  const guest2 = makeContext(port);
  vm.runInContext(`var netGuest2=new NetClient();netGuest2.resume({room:'${room}',role:'guest'});`, guest2);
  for (let i = 0; i < 300 && !(guest2.currentGame && guest2.netGuest2.connected); i++) await sleep(10);
  ok(!!guest2.currentGame, 'snapshot restored the match on the reconnected guest');
  ok(guest2.currentGame.stepNum === snapStep, 'restored at the host step (' + guest2.currentGame.stepNum + ' vs ' + snapStep + ')');
  ok(guest2.currentGame.stateHash() === hostGame.stateHash(), 'reconnected state matches the host exactly');

  // Keep playing through the resumed connection.
  let running2 = true;
  const guest2Loop = (async () => {
    while (running2) {
      const g = guest2.currentGame;
      if (g) for (let s = 0; s < 4 && g.netCanStep(); s++) g.step(1 / 120);
      await sleep(4);
    }
  })();
  while (hostGame.stepNum < snapStep + 200) {
    if (hostGame.netReady()) hostGame.step(1 / 120);
    const f = hostGame.stepNum;
    if (f === snapStep + 40) { hostGame.keyDown('KeyJ'); hostGame.keyUp('KeyJ'); }
    await sleep(2);
  }
  running2 = false;
  await guest2Loop;
  const hashesAfter = host.netHost.hashes.size;
  ok(hashesAfter > 20, 'hash checks continue after the rejoin (' + hashesAfter + ')');
  ok(host.netHost.connected && guest2.netGuest2.connected, 'match resumed without desync');
  // The guest sim intentionally trails the host clock by a few steps; the
  // per-step hash cross-checks above are the equality proof at equal steps.
  ok(guest2.currentGame.stepNum > snapStep + 170, 'guest kept playing after the resume (' + guest2.currentGame.stepNum + ')');

  /* ---- zombie slot: a half-open dead connection must not block rejoins ---- */
  guest2.netGuest2.close(true); // clean leave frees the guest slot
  for (let i = 0; i < 100 && host.netHost.peerOnline; i++) await sleep(10);
  const zombie = await new Promise(res => {
    const ws = new WebSocket('ws://127.0.0.1:' + port);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'open', room, role: 'guest', v: 1 }));
    ws.onmessage = e => res({ ws, first: JSON.parse(e.data) });
  });
  ok(zombie.first.t === 'ok', 'zombie connection took the guest slot');
  const guest3 = makeContext(port);
  vm.runInContext(`var netGuest3=new NetClient();netGuest3.resume({room:'${room}',role:'guest'});`, guest3);
  for (let i = 0; i < 400 && !guest3.currentGame; i++) await sleep(25);
  ok(!!guest3.currentGame, 'stale slot was taken over and the match resumed (after ' + guest3.netGuest3.reconnectTries + ' retries)');
  ok(guest3.currentGame.stateHash() === hostGame.stateHash(), 'takeover restore matches the host exactly');

  /* ---- returning to selection keeps the room alive for a rematch ---- */
  vm.runInContext('netHost.onBack();', host);
  for (let i = 0; i < 100 && guest3.netGuest3.inMatch; i++) await sleep(10);
  ok(!host.netHost.inMatch && !guest3.netGuest3.inMatch, 'back returns both sides to the lobby');
  ok(host.netHost.connected && guest3.netGuest3.connected, 'room stays alive after reselect');
  ok(host.netHost.room === room, 'same room code kept');

  relay.close();
  console.log('net-relay: ' + checks + ' checks passed.');
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
