const assert = require('node:assert/strict');
const { parseCsv, buildSafeArtifacts, detectDelimiter } = require('./inspector-core.js');

const csv = '日付,摘要,金額,口座番号\r\n"2026/07/01","トヨタ,買付","1,234","123456789"\r\n"2026/07/02","売却","-500","123456789"';
const rows = parseCsv(csv, ',');
assert.deepEqual(rows[1], ['2026/07/01', 'トヨタ,買付', '1,234', '123456789']);

const artifacts = buildSafeArtifacts(rows, 0, {
  encoding: 'shift_jis',
  delimiter: ',',
});
const output = JSON.stringify(artifacts);
for (const secret of ['トヨタ', '123456789', '1,234', '-500', '2026/07/01']) {
  assert.equal(output.includes(secret), false, `leaked source value: ${secret}`);
}
assert.deepEqual(artifacts.report.headers, ['日付', '摘要', '金額', '口座番号']);
assert.equal(artifacts.report.rowCount, 2);
assert.match(artifacts.syntheticCsv, /2000\/01\/01/);
assert.match(artifacts.syntheticCsv, /\[文字列\]/);
assert.match(artifacts.syntheticCsv, /1000/);
assert.equal('rawRows' in artifacts.report, false);
assert.deepEqual(parseCsv('a,b\r\n"複数\n行",2', ','), [['a', 'b'], ['複数\n行', '2']]);
assert.throws(() => parseCsv('a,b\n"閉じていない,b', ','), /引用符/);
assert.equal(detectDelimiter('列1\t列2\n"カンマ,入り"\t値'), '\t');
assert.equal(artifacts.report.containsSourceDataValues, false);
assert.equal(artifacts.report.retainsSourceHeaders, true);
assert.equal('containsSourceValues' in artifacts.report, false);
console.log('inspector core tests passed');
