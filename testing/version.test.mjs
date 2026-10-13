// Version consistency checks. Run with: node testing/version.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');
const { APP_VERSION, APP_CODENAME, EXPECTED_CACHE } = await import('../js/version.js');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok - ' + name); }
  catch (e) { failed++; console.log('not ok - ' + name + '\n  ' + e.message); }
}

test('APP_VERSION is semver', () => assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/));
test('codename is set', () => assert.ok(APP_CODENAME.length > 0));
test('sw.js CACHE_NAME equals EXPECTED_CACHE', () => {
  const m = read('sw.js').match(/CACHE_NAME\s*=\s*'([^']+)'/);
  assert.ok(m, 'CACHE_NAME not found');
  assert.equal(m[1], EXPECTED_CACHE);
});
test('sw.js caches the version/shell modules', () => {
  const sw = read('sw.js');
  for (const f of ['version', 'shell', 'command-palette', 'easter-eggs', 'inspector']) assert.ok(sw.includes(`./js/${f}.js`), f);
});
test('README title carries the version', () => assert.ok(read('README.md').startsWith(`# Rack Builder v${APP_VERSION}`)));
test('export.js takes the version from version.js', () => {
  const s = read('js/export.js');
  assert.ok(!/_version:\s*'/.test(s));
  assert.ok(s.includes('APP_VERSION'));
});
test('no stale hard-coded v0.8.0 in app sources', () => {
  for (const f of ['index.html', 'js/i18n.js', 'minimalist/index.html'])
    assert.ok(!read(f).includes('v0.8.0'), f);
});
test('editions are declared', () => {
  assert.match(read('index.html'), /data-edition="main"/);
  assert.match(read('minimalist/index.html'), /data-edition="minimalist"/);
});
test('minimalist contains the same version and cache constants', () => {
  const m = read('minimalist/index.html');
  assert.ok(m.includes(`APP_VERSION = '${APP_VERSION}'`));
  assert.ok(m.includes(`EXPECTED_CACHE = '${EXPECTED_CACHE}'`));
});
if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all passed');
