const assert = require('node:assert/strict');
const { parseCsv, buildSafeArtifacts } = require('./inspector-core.js');

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
console.log('inspector core tests passed');
