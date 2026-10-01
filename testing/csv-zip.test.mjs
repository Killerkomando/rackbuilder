// Run: node testing/csv-zip.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCsvRows, parseCsvTable, writeCsv, detectCsvDelimiter } from '../js/csv.js';
import { createZip, crc32 } from '../js/zip.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

// ── CSV ──
test('simple rows', () => {
  assert.deepEqual(parseCsvRows('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
});
test('quoted comma, escaped quote, embedded newline', () => {
  assert.deepEqual(parseCsvRows('a,b\n"x,y","he said ""hi"""\n"l1\nl2",z'),
    [['a', 'b'], ['x,y', 'he said "hi"'], ['l1\nl2', 'z']]);
});
test('CRLF, BOM, blank lines, no trailing newline', () => {
  assert.deepEqual(parseCsvRows('\uFEFFa;b\r\n\r\n1;2'), [['a', 'b'], ['1', '2']]);
});
test('delimiter detection ignores quoted separators', () => {
  assert.equal(detectCsvDelimiter('"a,b";c;d\n'), ';');
  assert.equal(detectCsvDelimiter('a\tb\tc\n'), '\t');
  assert.equal(detectCsvDelimiter('a,b,c\n'), ',');
});
test('table: duplicate headers, short rows padded, trimmed', () => {
  const t = parseCsvTable('name, name ,x\n a ,b\n');
  assert.deepEqual(t.headers, ['name', 'name#2', 'x']);
  assert.deepEqual(t.rows, [{ name: 'a', 'name#2': 'b', x: '' }]);
});
test('writer quotes only when needed and round-trips', () => {
  const rows = [{ a: 'x,y', b: 'q"r', c: 'plain' }];
  const out = writeCsv(rows, ['a', 'b', 'c']);
  assert.equal(out, 'a,b,c\n"x,y","q""r",plain\n');
  assert.deepEqual(parseCsvTable(out).rows, rows);
});

// ── ZIP ──
test('crc32 known vector', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});
test('zip is readable by python zipfile and content matches', () => {
  const files = [
    { name: 'module-import.csv', data: 'device,module_bay\nA,1\n' },
    { name: 'ünï/interface-rename.csv', data: 'id,name\n1,Gi1\n' },
  ];
  const zip = createZip(files, new Date(2026, 9, 1, 12, 0, 0));
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const p = join(dir, 'out.zip');
  writeFileSync(p, zip);
  const py = `
import zipfile,sys
z=zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print("|".join(n+"="+z.read(n).decode().replace("\\n","/") for n in z.namelist()))
`;
  const out = execFileSync('python3', ['-c', py, p]).toString().trim();
  assert.equal(out, 'module-import.csv=device,module_bay/A,1/|ünï/interface-rename.csv=id,name/1,Gi1/');
});

console.log(`\n${passed} tests passed`);
