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
const longTsv = '列1\t列2\n"' + 'あ'.repeat(210000) + ',カンマ入り"\t値';
assert.equal(detectDelimiter(longTsv), '\t');
assert.equal(artifacts.report.retainsApprovedCategoryValues, false);
assert.equal('containsSourceFinancialValues' in artifacts.report, false);
assert.equal('containsSourceDataValues' in artifacts.report, false);
assert.equal(artifacts.report.retainsSourceHeaders, true);
assert.equal('containsSourceValues' in artifacts.report, false);
const sbiHeaders = ['約定日','銘柄','銘柄コード','市場','取引','期限','預り','課税','約定数量','約定単価','手数料/諸経費等','税額','受渡日','受渡金額/決済損益'];
const row = (transaction='現物買', term='当日', custody='特定', tax='課税') => ['2000/01/01','秘密の銘柄','9999','東証',transaction,term,custody,tax,'10','1234','100','20','2000/01/03','12340'];
const sbiRows = [sbiHeaders, row(), row('現物売','期間指定','一般','非課税'), row()];
const categories = buildSafeArtifacts(sbiRows, 0, { encoding: 'shift_jis', delimiter: ',' });
assert.deepEqual(categories.report.safeCategoryValues, {
  '取引': ['現物買', '現物売'],
  '期限': ['期間指定', '当日'],
  '預り': ['一般', '特定'],
  '課税': ['課税', '非課税'],
});
assert.equal(categories.report.retainsApprovedCategoryValues, true);
assert.equal(categories.report.categorySchema, 'sbi-trade-history-v1');
const durationCategory = buildSafeArtifacts([sbiHeaders, row('現物買', '6ヶ月')], 0, { encoding: 'shift_jis', delimiter: ',' });
assert.deepEqual(durationCategory.report.safeCategoryValues['期限'], ['6ヶ月']);
assert.throws(() => buildSafeArtifacts([sbiHeaders, row('現物買', '9999')], 0, { encoding: 'shift_jis', delimiter: ',' }), /期限/);
assert.equal(JSON.stringify(categories.report.safeCategoryValues).includes('秘密の銘柄'), false);
assert.equal(JSON.stringify(categories.report.safeCategoryValues).includes('9999'), false);
assert.equal(JSON.stringify(categories.report.safeCategoryValues).includes('count'), false);

const fakeHeaders = buildSafeArtifacts([['取引','期限'],['LEAKED_SECURITY','LEAKED_PRICE']], 0, { encoding: 'utf-8', delimiter: ',' });
assert.deepEqual(fakeHeaders.report.safeCategoryValues, {});
assert.equal(JSON.stringify(fakeHeaders.report.safeCategoryValues).includes('LEAKED'), false);

const padded = [...sbiHeaders]; padded[4] = ' 取引 ';
assert.deepEqual(buildSafeArtifacts([padded, row()], 0, { encoding: 'utf-8', delimiter: ',' }).report.safeCategoryValues, {});
const duplicate = [...sbiHeaders]; duplicate[5] = '取引';
assert.deepEqual(buildSafeArtifacts([duplicate, row()], 0, { encoding: 'utf-8', delimiter: ',' }).report.safeCategoryValues, {});

for (const unsafe of ['現物\u0000買', '現物\u001b買', '現物\u061c買', '現物\u200e買', '現物\u200f買', '現物\u202e買', '9999']) {
  assert.throws(() => buildSafeArtifacts([sbiHeaders, row(unsafe)], 0, { encoding: 'utf-8', delimiter: ',' }), /分類値/);
}

console.log('inspector core tests passed');
