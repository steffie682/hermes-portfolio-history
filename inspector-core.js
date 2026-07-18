(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SbiInspector = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function parseCsv(text, delimiter) {
    const rows = [];
    let row = [], field = '', quoted = false, closedQuote = false;
    const finishField = () => { row.push(field); field = ''; closedQuote = false; };
    const finishRow = () => { finishField(); rows.push(row); row = []; };
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (quoted) {
        if (char === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 1; }
          else { quoted = false; closedQuote = true; }
        } else field += char;
      } else if (closedQuote) {
        if (char === delimiter) finishField();
        else if (char === '\n' || char === '\r') {
          if (char === '\r' && text[i + 1] === '\n') i += 1;
          finishRow();
        } else if (!/\s/.test(char)) throw new Error('CSVの引用符の後に不正な文字があります');
      } else if (char === '"') {
        if (field.length) throw new Error('CSVの引用符の位置が不正です');
        quoted = true;
      } else if (char === delimiter) finishField();
      else if (char === '\n' || char === '\r') {
        if (char === '\r' && text[i + 1] === '\n') i += 1;
        finishRow();
      } else field += char;
    }
    if (quoted) throw new Error('CSVに閉じていない引用符があります');
    if (field.length || row.length || closedQuote) finishRow();
    return rows.filter((candidate) => candidate.some((value) => value.length));
  }

  function classify(value) {
    const input = String(value).trim();
    if (!input) return 'empty';
    if (/^\d{4}([/.\-])\d{1,2}\1\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(input) || /^\d{4}年\d{1,2}月\d{1,2}日$/.test(input)) return 'date';
    if (/^[（(]?[-+]?\s*[¥￥$€£]?\s*[\d,]+(?:\.\d+)?\s*%?[）)]?$/.test(input)) return input.endsWith('%') ? 'percent' : 'number';
    return 'text';
  }

  function safeValue(value) {
    const type = classify(value);
    if (type === 'empty') return '';
    if (type === 'date') return '2000/01/01';
    if (type === 'percent') return '1.00%';
    if (type === 'number') return '1000';
    return '[文字列]';
  }

  function escapeCsv(value, delimiter) {
    let safe = String(value);
    if (/^[=+\-@]/.test(safe)) safe = "'" + safe;
    return safe.includes(delimiter) || /["\r\n]/.test(safe)
      ? '"' + safe.replaceAll('"', '""') + '"'
      : safe;
  }

  function buildSafeArtifacts(rows, headerRowIndex, metadata) {
    if (!Number.isInteger(headerRowIndex) || headerRowIndex < 0 || headerRowIndex >= rows.length) throw new Error('見出し行を選んでください');
    const delimiter = metadata.delimiter === '\t' ? '\t' : ',';
    const headers = rows[headerRowIndex].map((header, index) => String(header).trim() || `列${index + 1}`);
    const dataRows = rows.slice(headerRowIndex + 1).filter((row) => row.some((value) => String(value).trim()));
    const columns = headers.map((header, index) => {
      const patterns = { empty: 0, date: 0, number: 0, percent: 0, text: 0 };
      let maximumLength = 0;
      for (const row of dataRows) {
        const value = String(row[index] ?? '');
        patterns[classify(value)] += 1;
        maximumLength = Math.max(maximumLength, value.length);
      }
      return { header, patterns, maximumLength };
    });
    const syntheticRows = dataRows.slice(0, 5).map((row) => headers.map((_, index) => safeValue(row[index] ?? '')));
    const syntheticCsv = [headers, ...syntheticRows]
      .map((row) => row.map((value) => escapeCsv(value, delimiter)).join(delimiter))
      .join('\r\n') + '\r\n';
    return {
      report: {
        formatVersion: 1,
        documentKind: 'csv-structure-only',
        encoding: metadata.encoding,
        delimiter: delimiter === '\t' ? 'tab' : 'comma',
        headerRowNumber: headerRowIndex + 1,
        rowCount: dataRows.length,
        columnCount: headers.length,
        headers,
        columns,
        containsSourceDataValues: false,
        retainsSourceHeaders: true,
      },
      syntheticCsv,
    };
  }

  function detectDelimiter(text) {
    const sample = text;
    const candidates = [',', '\t'];
    return candidates.map((delimiter) => {
      try { return { delimiter, width: parseCsv(sample, delimiter).reduce((max, row) => Math.max(max, row.length), 0) }; }
      catch { return { delimiter, width: 0 }; }
    }).sort((a, b) => b.width - a.width)[0].delimiter;
  }

  return { parseCsv, buildSafeArtifacts, detectDelimiter, classify };
});
