/* LAN lockstep regression suite: two FightGame instances fed through the same
   record exchange must stay bit-identical, mimic picks included, and a fresh
   instance must resume from a host snapshot. */
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..');
const c = { console }; c.window = c; vm.createContext(c);
for (const f of ['assets', 'roster', 'meme-roster', 'roster-revision3', 'meme-art', 'meme-visuals', 'meme-combat', 'animation-player', 'engine', 'net'])
  vm.runInContext(fs.readFileSync(path.join(root, f + '.js'), 'utf8'), c);
const { FightGame, NET, ROSTER } = c;
let checks = 0; function ok(test, msg) { checks++; assert(test, msg); }

const ATTACK_KEYS = ['KeyJ', 'KeyK', 'KeyU', 'KeyI', 'KeyO', 'KeyL'];
const ATTACK_KEYS2 = ['Numpad1', 'Numpad2', 'Numpad4', 'Numpad5', 'Numpad6', 'Numpad3'];

function makeGame(role, seed, chars) {
  const prng = NET.mulberry32(seed);
  return new FightGame(null, chars, {
    mode: 'net',
    random: prng,
    fxRandom: () => 0,
    audio: { play() { } },
    net: { role, randomState: () => prng.state(), setRandomState: s => prng.set(s) },
  });
}

const chars = [ROSTER.find(x => x.name === '奶龙'), ROSTER.find(x => x.name === '电棍')];
ok(chars[0] && chars[1], 'test fighters exist');

/* Host steps two per frame and ships a 4-step batch on every fourth step; the
   guest replies with frozen records DELAY steps ahead, exactly like net.js. */
function exchange(host, guest) {
  const n0 = host.stepNum - 3;
  const inputs = [];
  for (let i = 0; i < 4; i++) { const r = host.inputRecords.get(n0 + i)?.[0] || { k: 0, e: 0 }; inputs.push([r.k, r.e]); }
  for (let i = 0; i < 4; i++) guest.netSetRecord(n0 + i, 0, { k: inputs[i][0], e: inputs[i][1] });
  const h = n0 + 3;
  const mine = guest.netCreateRecords(h + 1, h + NET.DELAY);
  mine.forEach((rec, i) => host.netSetRecord(h + 1 + i, 1, rec));
}
function hostStepLoop(host, guest, until, script = []) {
  let next = 0;
  while (host.stepNum < until) {
    for (let s = 0; s < 2 && host.netReady(); s++) {
      host.step(1 / 120);
      if (host.stepNum % 4 === 3) exchange(host, guest);
    }
    const budget = guest.netBacklog() > 16 ? 8 : 2;
    for (let s = 0; s < budget && guest.netCanStep(); s++) guest.step(1 / 120);
    while (next < script.length && script[next][0] <= host.stepNum) script[next++][1]();
  }
  // The last partial batch never fires once the host stops, so hand the guest
  // every trailing record (in the real game the host keeps stepping instead).
  for (let s = guest.stepNum + 1; s <= host.stepNum; s++) {
    const r = host.inputRecords.get(s)?.[0];
    if (r) guest.netSetRecord(s, 0, r);
  }
  for (let guard = 0; guest.stepNum < host.stepNum && guard < 1000; guard++)
    for (let s = 0; s < 8 && guest.netCanStep(); s++) guest.step(1 / 120);
}
function connect(host, guest) {
  const initial = guest.netCreateRecords(0, NET.DELAY - 1);
  initial.forEach((rec, i) => host.netSetRecord(i, 1, rec));
}

/* Test 1: key mask round-trips through the engine's own codec. */
{
  const g = makeGame('host', 1, chars);
  const d0 = [...g.decodeMask(g.keyMask(new Set(['KeyA', 'KeyW', 'KeyJ', 'Space']), 0), 0)].sort();
  ok(d0.join(',') === 'KeyA,KeyJ,KeyW', 'controller 0 round-trip folds Space into the jump bit: ' + d0);
  const d1 = [...g.decodeMask(g.keyMask(new Set(['ArrowLeft', 'ArrowUp', 'Numpad3']), 1), 1)].sort();
  ok(d1.join(',') === 'ArrowLeft,ArrowUp,Numpad3', 'controller 1 round-trip');
  ok(FightGame.KEY_BITS[0].attacks.length === 6, 'six attack bits per controller');
  for (const mapped of Object.values(NET.P1_TO_P2)) ok(g.controllerForCode(mapped) === 1, 'P1_TO_P2 target belongs to controller 1: ' + mapped);
  ok(g.keyMask(new Set(['KeyA']), 1) === 0, 'controller 0 code ignored on controller 1');
  // Net guests may type with the P1 key set; it is translated onto controller 1.
  const guestGame = makeGame('guest', 1, chars);
  guestGame.keyDown('KeyA'); guestGame.keyDown('KeyW'); guestGame.keyDown('KeyJ'); guestGame.keyDown('Space');
  const translated = guestGame.decodeMask(guestGame.keyMask(guestGame.keys, 1), 1);
  ok([...translated].sort().join(',') === 'ArrowLeft,ArrowUp,Numpad1', 'guest P1 keys translate to controller 1: ' + [...translated]);
  guestGame.keyUp('KeyA');
  ok(!guestGame.keys.has('ArrowLeft'), 'guest keyUp translates too');
}

/* Test 2: full lockstep match with scripted inputs on both machines. */
{
  const host = makeGame('host', 123456, chars), guest = makeGame('guest', 123456, chars);
  connect(host, guest);
  hostStepLoop(host, guest, 600, [
    [280, () => host.keyDown('KeyD')], [300, () => guest.keyDown('ArrowLeft')],
    [400, () => host.keyUp('KeyD')], [400, () => guest.keyUp('ArrowLeft')],
    [410, () => host.keyDown(ATTACK_KEYS[0])], [411, () => host.keyUp(ATTACK_KEYS[0])],
    [430, () => guest.keyDown(ATTACK_KEYS2[0])], [431, () => guest.keyUp(ATTACK_KEYS2[0])],
    [460, () => host.keyDown(ATTACK_KEYS[0])], [461, () => host.keyUp(ATTACK_KEYS[0])],
    [500, () => guest.keyDown('ArrowUp')], [503, () => guest.keyUp('ArrowUp')],
    [540, () => host.keyDown(ATTACK_KEYS[1])], [541, () => host.keyUp(ATTACK_KEYS[1])],
  ]);
  ok(host.stepNum === 600 && guest.stepNum === 600, 'both machines stepped 600 (' + host.stepNum + '/' + guest.stepNum + ')');
  ok(host.totalHits.reduce((a, b) => a + b, 0) > 0, 'attacks actually landed');
  ok(host.stateHash() === guest.stateHash(), 'state hashes match after 600 locked steps');
  const fields = f => [f.x, f.y, f.hp, f.energy, f.guard, f.stun, f.facing, f.combo, f.cooldowns, f.animTime];
  for (let i = 0; i < 2; i++) ok(JSON.stringify(fields(host.fighters[i])) === JSON.stringify(fields(guest.fighters[i])), 'fighter ' + i + ' fields identical');
  // The hash is quantized to 1e-4: last-ulp engine noise stays tolerated,
  // gross divergence is still caught.
  ok(host.canonical(42.1234501) === host.canonical(42.1234599), 'canonical quantizes last-ulp float noise');
  guest.fighters[1].x += 0.05;
  ok(host.stateHash() !== guest.stateHash(), 'hash detects a real divergence');
}

/* Test 3: mimic (乔希) picks the same donor via the synchronous PRNG draw. */
{
  const mimic = ROSTER.find(x => x.name === '乔希');
  ok(mimic && mimic.skills.every(s => s.mimic), '乔希 is the mimic roster entry');
  const pair = [mimic, chars[1]];
  const host = makeGame('host', 777, pair), guest = makeGame('guest', 777, pair);
  connect(host, guest);
  let pressed = false;
  const script = [
    [300, () => { host.keyDown(ATTACK_KEYS[2]); host.keyUp(ATTACK_KEYS[2]); pressed = true; }],
    [420, () => { guest.keyDown(ATTACK_KEYS2[1]); guest.keyUp(ATTACK_KEYS2[1]); }],
  ];
  hostStepLoop(host, guest, 500, script);
  ok(pressed && host.stepNum === 500 && guest.stepNum === 500, 'mimic lockstep completes');
  ok(!host.fighters[0].castPending && !guest.fighters[0].castPending, 'net mode never defers mimics via castPending');
  ok(!!host.fighters[0].mimicHistory?.[2] && !!guest.fighters[0].mimicHistory?.[2], 'mimic executed on both machines');
  ok(host.stateHash() === guest.stateHash(), 'mimic donor pick is deterministic');
}

/* Test 4: a fresh instance resumes from a mid-match host snapshot. */
{
  const host = makeGame('host', 42, chars), guest = makeGame('guest', 42, chars);
  connect(host, guest);
  hostStepLoop(host, guest, 450, [
    [280, () => host.keyDown('KeyD')], [300, () => guest.keyDown('ArrowLeft')],
    [400, () => host.keyUp('KeyD')], [400, () => guest.keyUp('ArrowLeft')],
    [410, () => host.keyDown(ATTACK_KEYS[0])], [411, () => host.keyUp(ATTACK_KEYS[0])],
    [430, () => guest.keyDown(ATTACK_KEYS2[0])], [431, () => guest.keyUp(ATTACK_KEYS2[0])],
    [444, () => host.keyDown(ATTACK_KEYS[2])], [445, () => host.keyUp(ATTACK_KEYS[2])],
  ]);
  const snap = host.snapshot();
  ok(snap.step === host.stepNum, 'snapshot carries the current step');
  const roundTrip = JSON.parse(JSON.stringify(snap));
  ok(JSON.stringify(roundTrip) === JSON.stringify(snap), 'snapshot survives a JSON round-trip');
  const guest2 = makeGame('guest', 987654, chars); // fresh instance, wrong seed
  guest2.restore(roundTrip);
  ok(guest2.stepNum === snap.step, 'restore rewinds the step counter');
  ok(guest2.stateHash() === host.stateHash(), 'restored state matches the host exactly');
  const mine = guest2.netCreateRecords(snap.step + 1, snap.step + NET.DELAY);
  mine.forEach((rec, i) => host.netSetRecord(snap.step + 1 + i, 1, rec));
  hostStepLoop(host, guest2, 650, [
    [500, () => host.keyDown(ATTACK_KEYS[0])], [501, () => host.keyUp(ATTACK_KEYS[0])],
    [560, () => guest2.keyDown(ATTACK_KEYS2[0])], [561, () => guest2.keyUp(ATTACK_KEYS2[0])],
  ]);
  ok(host.stepNum === 650 && guest2.stepNum === 650, 'lockstep continues after the restore (' + host.stepNum + '/' + guest2.stepNum + ')');
  ok(host.stateHash() === guest2.stateHash(), 'hashes stay equal after snapshot resume');
}

console.log('net-sync: ' + checks + ' checks passed.');
