import assert from 'node:assert/strict';
import { encodeState, decodeState, loadSavedState, saveState, buildShareUrl } from '../src/utils/state.js';

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};
function setLocation(search = '', pathname = '/') {
  globalThis.window = { location: { search, pathname, origin: 'http://localhost:5173' } };
}
setLocation();

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('ok   ' + name);
  } catch (e) {
    failures++;
    console.log('FAIL ' + name + '\n  ' + e.message);
  }
}

check('encode/decode round-trip preserves nested config', () => {
  const state = {
    year: 2024,
    totalSeats: 600,
    seatMethod: 'population',
    minSeats: 2,
    parties: [
      { id: 'p1', name: '工人联合阵线', enabled: true },
      { id: 'p2', name: '自由民主党', enabled: false },
    ],
  };
  assert.deepEqual(decodeState(encodeState(state)), state);
});

check('unicode + special chars survive round-trip', () => {
  const state = { note: '华域/测试?&=+%#@汉字', n: 0.123456789 };
  assert.deepEqual(decodeState(encodeState(state)), state);
});

check('encode uses base64url without padding', () => {
  const encoded = encodeState({ a: 1 });
  assert.ok(!/\+|\/|=/.test(encoded), 'no +,/ or = padding allowed');
  assert.ok(/^[A-Za-z0-9_-]+$/.test(encoded));
});

check('decode rejects garbage', () => {
  assert.equal(decodeState('!!!not-base64!!!'), null);
  assert.equal(decodeState('aGVsbG8='), null); // valid b64 but invalid JSON
});

check('empty object round-trips', () => {
  assert.deepEqual(decodeState(encodeState({})), {});
});

check('loadSavedState prefers URL param over localStorage', () => {
  const state = { totalSeats: 500 };
  saveState({ totalSeats: 999 });
  setLocation('?s=' + encodeState(state));
  assert.deepEqual(loadSavedState(), state);
  setLocation();
});

check('loadSavedState falls back to localStorage', () => {
  saveState({ totalSeats: 300 });
  setLocation('?other=1');
  assert.deepEqual(loadSavedState(), { totalSeats: 300 });
  setLocation();
});

check('buildShareUrl is parseable and restores state', () => {
  const state = { seatMethod: 'sainte_lague', parties: [{ id: 'p3', name: '绿色未来党' }] };
  const url = buildShareUrl(state);
  assert.match(url, /^http:\/\/localhost:5173\/\?s=/);
  const encoded = new URL(url).searchParams.get('s');
  assert.deepEqual(decodeState(encoded), state);
});

setLocation('');
storage.clear();
if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nall state.js tests passed');
