/* LAN 1V1 play: WebSocket room relay client, delay-based deterministic lockstep.
   Both machines run the full FightGame sim; only input masks cross the wire.
   The host is the state authority: any (re)join mid-match gets a full snapshot.
   No DOM access at module top level (the vm test suite loads this file). */
const NET = {
  VERSION: 1,
  DELAY: 6,        // guest sends input records DELAY steps ahead of the host clock
  BATCH: 4,        // host batches controller-0 records every BATCH steps
  HASH_EVERY: 24,  // state checksum cadence (steps)
  P1_TO_P2: { KeyA: 'ArrowLeft', KeyD: 'ArrowRight', KeyW: 'ArrowUp', KeyS: 'ArrowDown', KeyJ: 'Numpad1', KeyK: 'Numpad2', KeyU: 'Numpad4', KeyI: 'Numpad5', KeyO: 'Numpad6', KeyL: 'Numpad3' },
  mulberry32(a) {
    a |= 0;
    const next = () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    next.state = () => a;
    next.set = s => { a = s | 0; };
    return next;
  },
  fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  },
  rosterHash() {
    try {
      const roster = ROSTER.map(c => [c.id, c.name, c.skills.map(s => [s.type, s.damage, s.duration, s.start, s.range, s.count, s.pulses, s.cd, s.super ? 1 : 0])]);
      return NET.fnv1a(JSON.stringify([roster, window.MIMIC_POOLS || []]));
    } catch { return 'unknown'; }
  },
  relayURL() {
    const param = new URLSearchParams(location.search).get('relay');
    if (param) return param;
    if (location.protocol === 'file:') return 'ws://127.0.0.1:3101';
    return (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws';
  },
  randomCode() {
    const pool = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) code += pool[Math.floor(Math.random() * pool.length)];
    return code;
  },
};
window.NET = NET;

class NetClient {
  constructor() {
    this.role = null;          // 'host' | 'guest' | null
    this.room = null;
    this.ws = null;
    this.connected = false;    // open + ok + hello handshake done
    this.intentional = false;  // we closed on purpose (leave) — never reconnect
    this.inMatch = false;
    this.hostReady = false;    // host pressed 开打
    this.guestReady = false;   // guest pressed 开打 and finished preloading
    this.sentReady = false;    // guest side: we already signalled ready
    this.myRematch = false;
    this.peerRematch = false;
    this.hashes = new Map();   // host: step -> stateHash ring
    this.stallTimer = null;    // host: alive-but-silent peer watchdog
    this.rejoinTimer = null;   // host: wait-for-rejoin countdown
    this.reconnectTries = 0;
    this.reconnectTimer = null;
    this.peerOnline = false;
    this.guestEscapeHinted = false;
    this.lastHashOk = true;
    this.exchanged = false;   // first input exchange happened (arms the stall watchdog)
  }
  status(msg, kind = '') {
    for (const id of ['net-status', 'net-status-battle']) {
      const el = document.getElementById(id);
      if (el) { el.textContent = msg; el.className = 'net-status ' + kind; }
    }
  }
  clearStatus() {
    for (const id of ['net-status', 'net-status-battle']) {
      const el = document.getElementById(id);
      if (el) { el.textContent = ''; el.className = 'net-status'; }
    }
  }
  /* ---- connection ---- */
  createRoom() {
    if (this.ws) this.close(true);
    this.role = 'host';
    this.room = NET.randomCode();
    this.inMatch = false;
    this.exchanged = false;
    this.connect();
  }
  joinRoom(code) {
    if (this.ws) this.close(true);
    this.role = 'guest';
    this.room = String(code || '').toUpperCase();
    this.inMatch = false;
    this.exchanged = false;
    this.connect();
  }
  /* Resume after a page reload: reconnect to the same room as the same role;
     if the host is still in the match it answers with a snapshot. */
  resume(saved) {
    if (this.ws) this.close(true);
    this.role = saved.role;
    this.room = saved.room;
    this.inMatch = true;
    this.connect();
  }
  relayTarget() {
    // The relay input lets a guest point at the room host's machine when both
    // machines run their own server (rooms live on the creator's relay only).
    const input = document.getElementById('net-relay');
    return (input?.value || '').trim() || NET.relayURL();
  }
  connect() {
    this.intentional = false;
    this.connected = false;
    this.opened = false; // set true once the relay answers our open message
    this.status(this.role === 'host' ? '正在创建房间 ' + this.room + '…' : '正在加入房间 ' + this.room + '…');
    let ws;
    try { ws = new WebSocket(this.relayTarget()); } catch { this.status('中转地址无效：请确认格式为 ws://对方IP:端口/ws', 'error'); return; }
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'open', room: this.room, role: this.role, v: NET.VERSION }));
    ws.onmessage = e => { try { this.onMessage(JSON.parse(e.data)); } catch (err) { console.error('net message error:', err); } };
    ws.onclose = () => this.onClose();
    ws.onerror = () => { /* onclose follows */ };
  }
  send(msg) {
    if (this.ws?.readyState === 1) { try { this.ws.send(JSON.stringify(msg)); } catch { /* closing */ } }
  }
  close(intentional = false) {
    this.intentional = intentional;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.stallTimer);
    clearInterval(this.rejoinTimer);
    this.reconnectTimer = this.stallTimer = this.rejoinTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) { try { ws.onclose = null; ws.close(); } catch { /* already gone */ } }
  }
  onClose() {
    this.connected = false;
    this.peerOnline = false;
    if (this.intentional || !this.room) return;
    if (!this.opened) {
      // The relay never answered: a real connection problem, not a drop.
      // Retry briefly, then stop with actionable guidance instead of looping.
      if (this.reconnectTries < 5) { this.scheduleReconnect(); return; }
      this.status('无法连接中转：请确认两台电脑在同一局域网、建房一方已运行 npm run dev（或双击 start.bat）且防火墙已放行；两机各自建房时请在「中转地址」填入对方电脑的地址（如 ws://对方IP:3100/ws）', 'error');
      this.close(true);
      return;
    }
    // Unexpected drop: retry with backoff; the relay keeps the room alive and
    // the host resends a snapshot on rejoin, so the match resumes seamlessly.
    this.reconnectTries = 0;
    this.scheduleReconnect();
  }
  scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectTries), 8000);
    this.reconnectTries++;
    this.status('连接已断开，正在重连…（' + this.reconnectTries + '）', 'error');
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.reconnectTries > 6) { // ~60s total
        this.abort('重连失败：无法回到房间，已返回选人');
        return;
      }
      this.connect();
    }, delay);
  }
  storeJoin() {
    // inMatch=true is what lets a page reload resume a running match; lobby
    // sessions are not restored, so stale entries cannot swap roles later.
    try { sessionStorage.setItem('net-join', JSON.stringify({ room: this.room, role: this.role, inMatch: this.inMatch })); } catch { /* private mode */ }
  }
  clearJoin() {
    try { sessionStorage.removeItem('net-join'); } catch { /* ignore */ }
  }
  /* ---- message dispatch ---- */
  onMessage(msg) {
    switch (msg.t) {
      case 'ok': this.onOk(msg); break;
      case 'err': this.onErr(msg); break;
      case 'peer': this.onPeer(); break;
      case 'bye': this.onBye(); break;
      case 'hello': this.onHello(msg); break;
      case 'mismatch': this.abort('双方游戏版本不一致，请都使用最新版本'); break;
      case 'pick': this.onPick(msg); break;
      case 'ready': this.guestReady = true; this.status('对手已准备'); this.maybeGo(); break;
      case 'host-ready': if (!this.inMatch && this.role === 'guest' && !this.sentReady) this.status('房主已准备 · 请选好角色后点击「开打」'); break;
      case 'go': this.onGo(msg); break;
      case 'snap': this.onSnap(msg).catch(err => console.error('net snap error:', err)); break;
      case 's': this.onBatch(msg); break;
      case 'i': this.onInput(msg); break;
      case 'h': this.onHash(msg); break;
      case 'desync': this.abort('游戏不同步，已中止（请使用相同浏览器）'); break;
      case 'pause': this.status('房主已暂停'); if (typeof syncMusic === 'function') syncMusic(); break;
      case 'resume': this.clearStatus(); if (typeof syncMusic === 'function') syncMusic(); break;
      case 'rematch': this.onRematch(); break;
      case 'back': this.onPeerBack(); break;
      case 'leave': this.abort('对手已离开'); break;
    }
  }
  onOk(msg) {
    if (msg.role !== this.role) { this.abort('房间角色冲突'); return; }
    this.opened = true;
    this.storeJoin();
    const codeInput = document.getElementById('net-code');
    if (codeInput) codeInput.value = this.room;
    if (this.role === 'guest') {
      // The guest picks for its own slot; slot 0 belongs to the host.
      try { side = 1; } catch { /* not on the selection screen */ }
    }
    this.send({ t: 'hello', v: NET.VERSION, rosterHash: NET.rosterHash(), rejoin: this.inMatch });
    this.status(this.role === 'host' ? '房间已创建 · 房间码 ' + this.room + ' · 把房间码告诉对手，等待加入…' : '已加入房间 ' + this.room + ' · 选好角色后点「开打」准备');
    if (typeof refresh === 'function') refresh();
  }
  onErr(msg) {
    // A full room usually means the previous connection is still registered
    // on the relay (half-open socket after a drop); the relay takes over
    // stale slots automatically, so keep retrying instead of giving up.
    if (msg.reason === 'full') {
      this.status('房间暂满：对方旧连接尚未释放，稍后自动重试…', 'error');
      return; // the relay closes the socket; onClose drives the retry
    }
    const text = { 'bad-room': '房间码应为 4 位字母或数字', 'exists': '房间已存在：换一个房间码创建，或直接加入它', 'missing': '房间不存在：确认房间码输入正确；若对方是在另一台电脑上创建的房间，请在「中转地址」填入对方电脑的地址（如 ws://对方IP:3100/ws）后再连接' }[msg.reason] || '加入失败';
    this.status(text, 'error');
    this.close(true);
  }
  onPeer() {
    this.peerOnline = true;
    clearTimeout(this.reconnectTimer);
    if (!this.connected) {
      // Peer (re)joined our room: finish the handshake against them. The host
      // answers the peer's own hello with a snapshot (see onHello) — sending
      // one here too would double-build the peer's game.
      this.connected = true;
      this.send({ t: 'hello', v: NET.VERSION, rosterHash: NET.rosterHash(), rejoin: this.inMatch });
    }
    if (this.inMatch) {
      this.status('对手已重连，继续战斗');
      this.clearRejoinWait();
    } else {
      this.status('对手已加入 · 房间 ' + this.room + ' · 各自选人');
    }
    if (typeof refresh === 'function') refresh();
  }
  onBye() {
    this.peerOnline = false;
    this.connected = false;
    clearInterval(this.stallTimer);
    this.stallTimer = null;
    if (this.intentional) return;
    if (this.inMatch) {
      this.startRejoinWait();
    } else {
      this.status('对手已离开 · 房间 ' + this.room + ' · 等待新的对手…');
    }
    if (typeof refresh === 'function') refresh();
  }
  onHello(msg) {
    if (msg.rosterHash !== NET.rosterHash() && msg.rosterHash !== 'unknown') {
      this.send({ t: 'mismatch', rosterHash: NET.rosterHash() });
      this.abort('双方游戏版本不一致，请都使用最新版本');
      return;
    }
    this.connected = true;
    if (this.role === 'host') {
      if (this.inMatch) this.sendSnap(); // guest rejoin / fresh join mid-match
      else { this.send({ t: 'pick', idx: selected[0] }); this.status('对手已加入 · 房间 ' + this.room + ' · 各自选人'); }
    }
  }
  /* ---- lobby ---- */
  sendPick(idx) {
    if (!this.connected) return;
    this.send({ t: 'pick', idx });
    this.status(this.role === 'host' ? '等待对手选人…' : '等待房主开始…');
  }
  onPick(msg) {
    // A pick arriving while we thought we were in a match means the host went
    // back to selection (or the lobby is fresh); drop back to lobby state.
    if (this.inMatch) { this.inMatch = false; this.clearStatus(); }
    selected[this.role === 'host' ? 1 : 0] = msg.idx;
    if (typeof refresh === 'function') refresh();
  }
  startClicked() {
    if (!this.connected) { this.status('请先创建或加入房间', 'error'); return; }
    if (this.role === 'host') {
      this.hostReady = true;
      if (!this.guestReady) {
        this.status('等待对手准备…');
        // Tell the guest the host is ready so they know to click 开打 too.
        this.send({ t: 'host-ready' });
      }
      this.maybeGo();
      return;
    }
    // Guest: preload both fighters first (the stage comes with the go message).
    const startBtn = document.getElementById('start');
    if (startBtn) { startBtn.disabled = true; startBtn.textContent = '准备中…'; }
    this.status('正在准备角色，稍候…');
    (async () => {
      try {
        const chars = [ROSTER[selected[0]], ROSTER[selected[1]]];
        await Promise.all(chars.map(c => ensureCharacter(c)));
        this.sentReady = true;
        this.send({ t: 'ready', ready: true });
        this.status('已准备 · 等待房主开始…');
        if (startBtn) startBtn.textContent = '等待房主开始…';
      } catch (err) {
        this.status('准备失败：' + err.message + '，请重试', 'error');
        if (startBtn) { startBtn.disabled = false; startBtn.innerHTML = '准备好了，开打！ <span>↗</span>'; }
      }
    })();
  }
  maybeGo() {
    if (!(this.role === 'host' && this.hostReady && this.guestReady && this.connected)) return;
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const stage = stagePicker.choose();
    this.send({ t: 'go', v: NET.VERSION, seed, fighters: [selected[0], selected[1]], stage: stage.id, rosterHash: NET.rosterHash() });
    this.status('开打！');
    this.startMatch(seed, [selected[0], selected[1]], stage.id).catch(() => { });
  }
  onGo(msg) {
    if (msg.rosterHash !== NET.rosterHash() && msg.rosterHash !== 'unknown') { this.abort('双方游戏版本不一致，请都使用最新版本'); return; }
    this.myRematch = this.peerRematch = false;
    this.clearStatus();
    this.startMatch(msg.seed, msg.fighters, msg.stage);
  }
  /* ---- match plumbing (wired to the FightGame via options.net) ---- */
  async startMatch(seed, fighterIndices, stageId, sendInitial = true) {
    this.inMatch = true;
    this.exchanged = false;
    this.storeJoin(); // record the in-progress match for page-reload resume
    const prng = NET.mulberry32(seed);
    const role = this.role;
    const game = await launchNetGame(fighterIndices, stageId, {
      net: {
        role,
        randomState: () => prng.state(),
        setRandomState: s => prng.set(s),
        onBatch: n0 => this.sendBatch(game, n0),
        onHash: (step, hash) => this.handleHash(step, hash),
        onStall: stalled => this.handleStall(stalled),
        onGuestEscape: () => {
          if (this.guestEscapeHinted) return;
          this.guestEscapeHinted = true;
          this.status('只有房主可以暂停', 'error');
          setTimeout(() => { this.guestEscapeHinted = false; }, 2500);
        },
      },
      random: prng,
      fxRandom: Math.random,
    });
    if (!game) { this.status('角色载入失败，请重试', 'error'); this.inMatch = false; return null; }
    if (role === 'guest' && sendInitial) {
      // Freeze our own records for steps 0..DELAY-1 so the host can start.
      this.sendInputs(0, game.netCreateRecords(0, NET.DELAY - 1));
    }
    return game;
  }
  sendBatch(game, n0) {
    const inputs = [];
    for (let i = 0; i < NET.BATCH; i++) {
      const rec = game.inputRecords.get(n0 + i)?.[0] || { k: 0, e: 0 };
      inputs.push([rec.k, rec.e]);
    }
    this.send({ t: 's', n0, inputs });
  }
  sendInputs(n0, records) {
    this.send({ t: 'i', n0, inputs: records.map(r => [r.k, r.e]) });
  }
  onBatch(msg) {
    const game = typeof currentGame !== 'undefined' ? currentGame : null;
    if (!game || game.mode !== 'net') return;
    for (let i = 0; i < msg.inputs.length; i++) {
      const [k, e] = msg.inputs[i];
      game.netSetRecord(msg.n0 + i, 0, { k, e });
    }
    const h = msg.n0 + msg.inputs.length - 1;
    this.sendInputs(h + 1, game.netCreateRecords(h + 1, h + NET.DELAY));
    if (!this.exchanged) { this.exchanged = true; this.clearStatus(); }
  }
  onInput(msg) {
    // Host: store the guest's frozen records so the clock can keep stepping.
    const game = typeof currentGame !== 'undefined' ? currentGame : null;
    if (!game || game.mode !== 'net') return;
    for (let i = 0; i < msg.inputs.length; i++) {
      const [k, e] = msg.inputs[i];
      game.netSetRecord(msg.n0 + i, 1, { k, e });
    }
    if (!this.exchanged) { this.exchanged = true; this.clearStatus(); }
  }
  handleHash(step, hash) {
    if (this.role === 'host') {
      this.hashes.set(step, hash);
      for (const s of [...this.hashes.keys()]) if (s < step - 96 * NET.HASH_EVERY) this.hashes.delete(s);
    } else {
      this.send({ t: 'h', step, hash });
    }
  }
  onHash(msg) {
    const mine = this.hashes.get(msg.step);
    if (mine === undefined) return;
    if (mine !== msg.hash) {
      // Hash values are quantized to 1e-4, so a lone mismatch is almost
      // certainly a quantization boundary crossing at a slightly different
      // step on the other machine; only two consecutive mismatches abort.
      if (!this.lastHashOk) {
        this.send({ t: 'desync', step: msg.step });
        this.abort('游戏不同步，已中止（请使用相同浏览器）');
      } else {
        this.lastHashOk = false;
        console.warn('net hash tolerance exceeded at step ' + msg.step + ', waiting to confirm');
      }
    } else this.lastHashOk = true;
  }
  handleStall(stalled) {
    clearInterval(this.stallTimer);
    this.stallTimer = null;
    if (!stalled) return;
    // Socket alive but no guest records: either the peer is still loading its
    // match assets (normal at start) or its JS is suspended (a real hang).
    if (!this.peerOnline) return; // offline peers are handled by rejoin-wait
    if (!this.exchanged) { this.status('等待对手载入角色…'); return; }
    this.stallTimer = setInterval(() => {
      clearInterval(this.stallTimer);
      this.stallTimer = null;
      this.abort('对手无响应，已中止对局');
    }, 10000);
  }
  startRejoinWait() {
    clearInterval(this.rejoinTimer);
    let left = 120;
    const tick = () => {
      this.status('对手已掉线 · 房间码 ' + this.room + ' · 等待重连 ' + left + 's');
      if (--left < 0) {
        clearInterval(this.rejoinTimer);
        this.rejoinTimer = null;
        this.abort('等待对手重连超时，已返回选人');
      }
    };
    tick();
    this.rejoinTimer = setInterval(tick, 1000);
  }
  clearRejoinWait() {
    clearInterval(this.rejoinTimer);
    this.rejoinTimer = null;
    this.clearStatus();
  }
  /* ---- rejoin handoff: the host is always the state authority ---- */
  sendSnap() {
    const game = typeof currentGame !== 'undefined' ? currentGame : null;
    if (!game || game.mode !== 'net') return;
    const fighters = game.characters.map(c => ROSTER.indexOf(c));
    this.send({ t: 'snap', v: NET.VERSION, step: game.stepNum, fighters, stage: typeof currentStage !== 'undefined' && currentStage ? currentStage.id : null, state: game.snapshot() });
    this.status('对手已重连，继续战斗');
    this.clearRejoinWait();
  }
  async onSnap(msg) {
    // Ignore duplicate snapshots for the same step: rebuilding the game would
    // orphan input records that already arrived for the next steps.
    const game = typeof currentGame !== 'undefined' ? currentGame : null;
    if (game?.mode === 'net' && game.stepNum >= msg.step) {
      const from = game.stepNum + 1;
      this.sendInputs(from, game.netCreateRecords(from, from + NET.DELAY - 1));
      return;
    }
    this.inMatch = true;
    this.clearStatus();
    const fresh = await this.startMatch(1, msg.fighters, msg.stage, false);
    if (!fresh) return;
    fresh.restore(msg.state); // restore() also rewinds the PRNG via setRandomState
    const from = msg.step + 1;
    this.sendInputs(from, fresh.netCreateRecords(from, from + NET.DELAY - 1));
  }
  /* ---- pause / rematch / leave ---- */
  onGamePause(paused) { if (this.role === 'host') this.send(paused ? { t: 'pause' } : { t: 'resume' }); }
  rematch() {
    if (!this.inMatch || !this.connected) return;
    this.myRematch = true;
    this.send({ t: 'rematch' });
    this.status('等待对手也点再来一局…');
    if (this.role === 'host' && this.peerRematch) this.startRematch();
  }
  onRematch() {
    this.peerRematch = true;
    if (this.role === 'host' && this.myRematch) this.startRematch();
    else this.status('对手想再来一局，点击再来一局开始');
  }
  startRematch() {
    this.myRematch = this.peerRematch = false;
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const fighters = (typeof currentGame !== 'undefined' && currentGame) ? currentGame.characters.map(c => ROSTER.indexOf(c)) : [selected[0], selected[1]];
    const stage = stagePicker.choose();
    this.pendingStage = stage.id;
    this.send({ t: 'go', v: NET.VERSION, seed, fighters, stage: stage.id, rosterHash: NET.rosterHash() });
    this.startMatch(seed, fighters, stage.id).catch(() => { });
  }
  leave() {
    this.send({ t: 'leave' });
    this.close(true);
    this.clearJoin();
    this.reset();
    this.clearStatus();
  }
  onBack() {
    // Returning to selection keeps the room alive so both players can swap
    // characters and start a new match without recreating or rejoining.
    if (!this.connected) { this.reset(); return; }
    if (this.inMatch) this.send({ t: 'back' });
    this.resetMatch();
    this.storeJoin(); // now a lobby session: no page-reload resume
    this.status('已返回选人 · 房间 ' + this.room + ' 仍保留 · 双方重新选人后点开打');
  }
  onPeerBack() {
    // The opponent returned to selection: reset and follow them there.
    this.resetMatch();
    if (typeof goBack === 'function') { try { goBack(); } catch { /* already at selection */ } }
    this.status('双方已返回选人 · 房间 ' + this.room + ' 仍保留 · 重新选人后点开打');
  }
  abort(msg) {
    this.status(msg, 'error');
    this.close(true);
    this.clearJoin();
    this.reset();
    if (typeof goBack === 'function' && document.getElementById('battle') && !document.getElementById('battle').hidden) {
      try { goBack(); } catch { /* selection already shown */ }
    }
  }
  reset() {
    this.resetMatch();
    this.connected = false;
    this.peerOnline = false;
    this.reconnectTries = 0;
    clearTimeout(this.reconnectTimer);
  }
  /* Match-level state only; the room connection is kept. */
  resetMatch() {
    this.inMatch = false;
    this.hostReady = this.guestReady = false;
    this.sentReady = false;
    this.myRematch = this.peerRematch = false;
    this.exchanged = false;
    this.lastHashOk = true;
    this.hashes.clear();
    clearInterval(this.stallTimer);
    this.stallTimer = null;
    clearInterval(this.rejoinTimer);
    this.rejoinTimer = null;
  }
}
window.NetClient = NetClient;
