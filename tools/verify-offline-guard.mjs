import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const guard = new URL('./offline-guard.mjs', import.meta.url).href;
const cases = [
  ['fetch', "try { await fetch('https://offline-fixture.invalid/'); } catch {}", /forbids network access \(fetch\)/],
  ['socket', "import net from 'node:net'; try { net.createConnection({ host: '127.0.0.1', port: 1 }); } catch {}", /forbids network access \(net\)/],
  ['state read', "import { readFileSync } from 'node:fs'; try { readFileSync('state.json'); } catch {}", /forbids access to production state files/],
  ['async state read', "import { readFile } from 'node:fs/promises'; try { await readFile('fb-state.json'); } catch {}", /forbids access to production state files/],
];
for (const [name, source, message] of cases) {
  const result = spawnSync(process.execPath, ['--import', guard, '--input-type=module', '-e', source], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.error, undefined, `${name}: child must finish within its timeout`);
  assert.equal(result.status, 1, `${name}: caught forbidden access must still fail`);
  assert.match(result.stderr, message, `${name}: guard must identify its refusal`);
  assert.equal(result.stdout, '', `${name}: no requested data may be printed`);
}
console.log('PASS offline guard blocks fetch, sockets and named sync/async state reads before access');
