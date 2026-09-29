// Preload only for offline verification. Fixtures may replace fetch with their mocks.
import fs, { existsSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(root, '.env')) || existsSync(join(root, '.env.local'))) {
  throw new Error('Offline verification requires a checkout without local environment files');
}

process.env.ANTHROPIC_API_KEY = 'offline-fixture';
process.env.THREADS_ACCESS_TOKEN = 'offline-fixture';
process.env.FB_PAGE_ACCESS_TOKEN = 'offline-fixture';
process.env.BOT_CONFIRM_LIVE = 'no';
process.env.GITHUB_ACTIONS = 'false';
process.env.BOT_USAGE_LOG = 'off';
process.env.BOT_STATE_FILE = join(tmpdir(), `offline-unused-state-${process.pid}.json`);
process.env.BOT_FB_STATE_FILE = join(tmpdir(), `offline-unused-fb-state-${process.pid}.json`);

const productionStatePaths = new Set(['state.json', 'fb-state.json', 'state.json.tmp', 'fb-state.json.tmp']
  .map(file => resolve(root, file).toLowerCase()));
function assertFixturePath(file) {
  if (typeof file === 'number') return;
  const path = file instanceof URL ? fileURLToPath(file) : String(file);
  if (productionStatePaths.has(resolve(path).toLowerCase())) {
    process.exitCode = 1;
    const message = 'Offline verification forbids access to production state files';
    console.error(message);
    throw new Error(message);
  }
}
for (const name of ['readFile', 'readFileSync', 'open', 'openSync', 'createReadStream',
  'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream', 'unlink', 'unlinkSync']) {
  const original = fs[name];
  fs[name] = function (file, ...args) {
    assertFixturePath(file);
    return original.call(this, file, ...args);
  };
}
for (const name of ['readFile', 'open', 'writeFile', 'appendFile', 'unlink']) {
  const original = fsPromises[name];
  fsPromises[name] = function (file, ...args) {
    assertFixturePath(file);
    return original.call(this, file, ...args);
  };
}
for (const target of [fs, fsPromises]) {
  for (const name of ['rename', ...(target === fs ? ['renameSync'] : [])]) {
    const original = target[name];
    target[name] = function (from, to, ...args) {
      assertFixturePath(from); assertFixturePath(to);
      return original.call(this, from, to, ...args);
    };
  }
}

function blockNetwork(transport) {
  return function () {
    // Fail even if application error handling catches the exception.
    process.exitCode = 1;
    const message = `Offline verification forbids network access (${transport})`;
    console.error(message);
    throw new Error(message);
  };
}

// tsx reports dependencies to its parent through a local pipe, not a network socket.
const tsxUser = typeof process.geteuid === 'function' ? process.geteuid() : userInfo().username;
const tsxParentPipe = join(tmpdir(), `tsx-${tsxUser}`, `${process.ppid}.pipe`);
function allowToolingPipe(original) {
  return function (...args) {
    let address = args[0];
    if (Array.isArray(address)) address = address[0];
    const path = typeof address === 'string' ? address : address?.path;
    const expected = process.platform === 'win32' ? `\\\\?\\pipe\\${tsxParentPipe}` : tsxParentPipe;
    if (path === expected) return original.apply(this, args);
    return blockNetwork('net')();
  };
}

globalThis.fetch = blockNetwork('fetch');
http.request = http.get = blockNetwork('http');
https.request = https.get = blockNetwork('https');
net.connect = allowToolingPipe(net.connect);
net.createConnection = allowToolingPipe(net.createConnection);
net.Socket.prototype.connect = allowToolingPipe(net.Socket.prototype.connect);
syncBuiltinESMExports();
