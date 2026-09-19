/* Minimal RFC 6455 WebSocket room relay with zero dependencies.
   Rooms keep their two slots (host + guest) until both sides leave, so a
   dropped connection can rejoin the same room and resume the match. */
import http from 'node:http';
import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 1 << 20; // 1 MiB payload cap; snapshots carry the full sim state

function accept(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

/* Server frames are never masked. */
function textFrame(payload) {
  const body = Buffer.from(payload, 'utf8');
  const head = body.length < 126
    ? Buffer.from([0x81, body.length])
    : Buffer.from([0x81, 126, body.length >> 8, body.length & 0xff]);
  return Buffer.concat([head, body]);
}

function controlFrame(opcode, payload = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload]);
}

/* Parse whole frames out of a buffer. Returns { frames, rest }. */
function readFrames(buf) {
  const frames = [];
  let offset = 0;
  while (buf.length - offset >= 2) {
    const b0 = buf[offset], b1 = buf[offset + 1];
    let length = b1 & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (buf.length - cursor < 2) break;
      length = buf.readUInt16BE(cursor); cursor += 2;
    } else if (length === 127) {
      if (buf.length - cursor < 8) break;
      length = Number(buf.readBigUInt64BE(cursor)); cursor += 8;
    }
    if (!Number.isSafeInteger(length) || length > MAX_FRAME) throw new Error('frame too large');
    const masked = (b1 & 0x80) !== 0;
    if (buf.length - cursor - (masked ? 4 : 0) < length) break;
    const mask = masked ? buf.subarray(cursor, cursor + 4) : null;
    cursor += masked ? 4 : 0;
    let payload = buf.subarray(cursor, cursor + length);
    if (mask) {
      payload = Buffer.allocUnsafe(length);
      for (let i = 0; i < length; i++) payload[i] = buf[cursor + i] ^ mask[i & 3];
    }
    frames.push({ op: b0 & 0x0f, payload });
    offset = cursor + length;
  }
  return { frames, rest: buf.subarray(offset) };
}

/* Wire a WebSocket relay onto an existing http server's upgrade event.
   accept(req) optionally filters which upgrade requests are treated as
   WebSocket connections (the dev server only relays /ws). Heartbeat pings
   keep every live socket's activity fresh (browsers auto-pong), so a slot
   held by a dead connection can be taken over after slotTakeoverMs instead of
   blocking rejoins until TCP gives up. */
export function attachRelay(server, { accept: shouldAccept = () => true, heartbeatMs = 5000, slotTakeoverMs = 12000 } = {}) {
  const rooms = new Map(); // code -> { host: Socket|null, guest: Socket|null }
  const stateOf = new WeakMap(); // socket -> { room, role, ok, buf, alive, missed }
  const sockets = new Set();

  function send(socket, msg) {
    if (!sockets.has(socket) || socket.destroyed) return;
    socket.write(textFrame(JSON.stringify(msg)));
  }

  function peerOf(socket) {
    const st = stateOf.get(socket), room = st?.room && rooms.get(st.room);
    if (!room) return null;
    return st.role === 'host' ? room.guest : room.host;
  }

  function teardown(socket) {
    const st = stateOf.get(socket);
    if (!st) return;
    stateOf.delete(socket);
    sockets.delete(socket);
    if (st.room) {
      const room = rooms.get(st.room);
      if (room) {
        if (room[st.role] === socket) room[st.role] = null;
        if (!room.host && !room.guest) rooms.delete(st.room);
        else {
          const peer = st.role === 'host' ? room.guest : room.host;
          if (peer) send(peer, { t: 'bye' });
        }
      }
    }
    try { socket.destroy(); } catch { /* already gone */ }
  }

  /* Reject an open attempt with a clean WebSocket close so clients see a
     normal close instead of an abrupt TCP reset. */
  function reject(socket, reason) {
    send(socket, { t: 'err', reason });
    socket.write(controlFrame(0x8, Buffer.from([0x03, 0xe8]))); // close, code 1000
    setTimeout(() => teardown(socket), 500);
  }

  function open(socket, msg, st) {
    const room = String(msg.room || '').toUpperCase();
    const role = msg.role === 'guest' ? 'guest' : 'host';
    if (!/^[A-Z0-9]{4}$/.test(room)) return reject(socket, 'bad-room');
    let entry = rooms.get(room);
    // A slot held by a connection that stopped producing frames (machine off,
    // wifi dropped, tab suspended) is taken over so the player can rejoin
    // right away; live idle players stay fresh through the ping/pong cycle.
    const stale = occupant => {
      const st2 = occupant && stateOf.get(occupant);
      return !st2 || Date.now() - st2.lastSeen > slotTakeoverMs;
    };
    if (role === 'host') {
      if (entry?.host) {
        if (!stale(entry.host)) return reject(socket, 'exists');
        teardown(entry.host);
        entry = rooms.get(room);
      }
      if (!entry) { entry = { host: null, guest: null }; rooms.set(room, entry); }
      entry.host = socket;
    } else {
      if (!entry) return reject(socket, 'missing');
      if (entry.guest) {
        if (!stale(entry.guest)) return reject(socket, 'full');
        teardown(entry.guest);
        entry = rooms.get(room) || entry;
        if (entry.guest) return reject(socket, 'full');
      }
      entry.guest = socket;
    }
    st.room = room;
    st.role = role;
    st.ok = true;
    send(socket, { t: 'ok', role });
    const peer = peerOf(socket);
    if (peer) send(peer, { t: 'peer' });
  }

  server.on('upgrade', (req, socket, head) => {
    if (!shouldAccept(req)) { socket.destroy(); return; }
    const key = req.headers['sec-websocket-key'];
    if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.destroy(); return; }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept(key) + '\r\n\r\n');
    const st = { room: null, role: null, ok: false, buf: Buffer.alloc(0), alive: true, missed: 0, lastSeen: Date.now() };
    stateOf.set(socket, st);
    sockets.add(socket);
    socket.setNoDelay(true);
    if (head?.length) st.buf = Buffer.concat([st.buf, head]);
    socket.on('data', chunk => {
      st.lastSeen = Date.now(); // any frame counts: pings and pongs included
      st.buf = Buffer.concat([st.buf, chunk]);
      try {
        const { frames, rest } = readFrames(st.buf);
        st.buf = rest;
        for (const frame of frames) {
          if (frame.op === 0x8) { teardown(socket); return; } // close
          if (frame.op === 0x9) { socket.write(controlFrame(0xa)); continue; } // ping -> pong
          if (frame.op === 0xa) { st.alive = true; st.missed = 0; continue; } // pong
          if (frame.op !== 0x1) continue; // text only
          const text = frame.payload.toString('utf8');
          if (!st.ok) {
            try { open(socket, JSON.parse(text), st); } catch { send(socket, { t: 'err', reason: 'bad-json' }); socket.end(); }
            continue;
          }
          const peer = peerOf(socket);
          if (peer) peer.write(textFrame(text));
        }
      } catch { teardown(socket); }
    });
    socket.on('close', () => teardown(socket));
    socket.on('error', () => teardown(socket));
  });

  const heartbeat = setInterval(() => {
    for (const socket of sockets) {
      const st = stateOf.get(socket);
      if (!st) continue;
      if (!st.alive) {
        st.missed++;
        if (st.missed >= 2) teardown(socket);
        continue;
      }
      st.alive = false;
      socket.write(controlFrame(0x9));
    }
  }, heartbeatMs);
  heartbeat.unref?.();

  return {
    close() {
      clearInterval(heartbeat);
      for (const socket of [...sockets]) teardown(socket);
    },
  };
}

/* Standalone relay server (`npm run relay`). */
export function createRelayServer({ port = 3101, host = '0.0.0.0', heartbeatMs, slotTakeoverMs } = {}) {
  const server = http.createServer((req, res) => {
    res.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('抽象格斗联机中转：请通过 WebSocket 连接');
  });
  const relay = attachRelay(server, { heartbeatMs, slotTakeoverMs });
  server.on('error', err => { console.error(err.message); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`抽象格斗联机中转：ws://${host}:${port}（首次运行请放行防火墙）`));
  return { server, ...relay };
}
