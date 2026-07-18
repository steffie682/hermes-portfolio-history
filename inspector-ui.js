(() => {
  const byId = (id) => document.getElementById(id);
  const fileInput = byId('file');
  const message = byId('message');
  const csvSection = byId('csv-section');
  const pdfSection = byId('pdf-section');
  const headerSelect = byId('header-row');
  const rawPreview = byId('raw-preview');
  const confirmed = byId('confirmed');
  const reportButton = byId('download-report');
  const fixtureButton = byId('download-fixture');
  let rows = [], metadata = {}, artifacts = null, pdfReport = null, selectionVersion = 0;

  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click();
    setTimeout(() => { URL.revokeObjectURL(url); anchor.remove(); }, 1000);
  }
  function decode(bytes) {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8-bom' };
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }; }
    catch { return { text: new TextDecoder('shift_jis').decode(bytes), encoding: 'shift_jis' }; }
  }
  function likelyHeaderIndex(data) {
    let best = 0, score = -1;
    data.slice(0, 30).forEach((row, index) => {
      const nonempty = row.filter((value) => String(value).trim()).length;
      const text = row.filter((value) => window.SbiInspector.classify(value) === 'text').length;
      const current = nonempty * 2 + text;
      if (current > score) { best = index; score = current; }
    });
    return best;
  }
  function renderRaw(selected) {
    rawPreview.replaceChildren();
    rows.slice(0, 15).forEach((row, index) => {
      const tr = document.createElement('tr'); if (index === selected) tr.className = 'selected';
      const number = document.createElement('th'); number.textContent = `${index + 1}行`; tr.append(number);
      row.slice(0, 12).forEach((value) => { const td = document.createElement(index === selected ? 'th' : 'td'); if (index === selected) td.setAttribute('scope', 'col'); td.textContent = String(value); tr.append(td); });
      rawPreview.append(tr);
    });
  }
  function clearArtifactConsent() {
    artifacts = null;
    confirmed.checked = false;
    reportButton.disabled = true;
    fixtureButton.disabled = true;
  }
  function regenerate() {
    clearArtifactConsent();
    const index = Number(headerSelect.value);
    renderRaw(index);
    try {
      const nextArtifacts = window.SbiInspector.buildSafeArtifacts(rows, index, metadata);
      artifacts = nextArtifacts;
      byId('summary').textContent = `${artifacts.report.rowCount}データ行・${artifacts.report.columnCount}列／${artifacts.report.encoding}／${artifacts.report.delimiter}`;
      const categoryLines = Object.entries(artifacts.report.safeCategoryValues)
        .map(([header, values]) => `${header}: ${values.join('／')}`);
      byId('safe-preview').textContent = [
        artifacts.syntheticCsv.split(/\r?\n/).slice(0, 7).join('\n'),
        '',
        artifacts.report.categorySchema ? '共有対象の選択肢（重複・件数なし）' : 'SBI約定履歴14列を認識しなかったため、分類値は含めません',
        ...categoryLines,
      ].join('\n');
      return true;
    } catch (error) {
      byId('summary').textContent = '安全な出力を生成できませんでした。';
      byId('safe-preview').textContent = '';
      message.textContent = error && typeof error.message === 'string' ? error.message : '安全な出力を生成できませんでした。';
      return false;
    }
  }
  function reset() {
    rows = []; artifacts = null; pdfReport = null; csvSection.hidden = true; pdfSection.hidden = true;
    headerSelect.disabled = false;
    confirmed.checked = false; reportButton.disabled = true; fixtureButton.disabled = true;
    byId('pdf-confirmed').checked = false; byId('download-pdf-report').disabled = true;
  }
  fileInput.addEventListener('change', async () => {
    const version = ++selectionVersion;
    reset(); const file = fileInput.files[0];
    if (!file) { message.textContent = 'ファイルはまだ選択されていません。'; return; }
    if (file.size > 25 * 1024 * 1024) { message.textContent = 'ファイルは25MB以下にしてください。'; return; }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (version !== selectionVersion) return;
      const pdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
      if (pdf) {
        pdfReport = { formatVersion: 1, documentKind: 'pdf-signature-metadata-only', hasPdfSignature: true, approximateSizeKiB: Math.ceil(bytes.byteLength / 1024), containsSourceContent: false };
        pdfSection.hidden = false; message.textContent = 'PDFらしい先頭記号を確認しました。内容やPDF構造の正常性は確認していません。'; return;
      }
      if (bytes.byteLength > 10 * 1024 * 1024) { message.textContent = 'CSVは10MB以下にしてください。'; return; }
      const decoded = decode(bytes); const delimiter = window.SbiInspector.detectDelimiter(decoded.text);
      rows = window.SbiInspector.parseCsv(decoded.text, delimiter);
      if (!rows.length || rows.every((row) => row.length < 2)) { message.textContent = '表形式のCSVとして認識できませんでした。'; return; }
      metadata = { encoding: decoded.encoding, delimiter };
      const approvedSchemaIndex = window.SbiInspector.findApprovedSchemaIndex(rows);
      const selected = approvedSchemaIndex >= 0 ? approvedSchemaIndex : likelyHeaderIndex(rows);
      headerSelect.replaceChildren();
      const selectableIndexes = rows.slice(0, 30).map((_, index) => index);
      if (approvedSchemaIndex >= 30) selectableIndexes.push(approvedSchemaIndex);
      selectableIndexes.forEach((index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = `${index + 1}行目`; option.selected = index === selected; headerSelect.append(option); });
      headerSelect.disabled = approvedSchemaIndex >= 0;
      csvSection.hidden = false;
      if (regenerate()) message.textContent = approvedSchemaIndex >= 0
        ? 'SBI約定履歴14列を認識し、見出し行を安全に固定しました。外部送信はしていません。'
        : 'CSVを端末内で読み取りました。外部送信はしていません。';
    } catch (error) {
      if (version === selectionVersion) message.textContent = error instanceof Error ? error.message : 'ファイルを読み取れませんでした。';
    }
  });
  headerSelect.addEventListener('change', regenerate);
  confirmed.addEventListener('change', () => { reportButton.disabled = !confirmed.checked || !artifacts; fixtureButton.disabled = !confirmed.checked || !artifacts; });
  reportButton.addEventListener('click', () => { if (artifacts) download('sbi-format-report.json', JSON.stringify(artifacts.report, null, 2) + '\n', 'application/json'); });
  fixtureButton.addEventListener('click', () => { if (artifacts) download('sbi-synthetic-fixture.csv', '\ufeff' + artifacts.syntheticCsv, 'text/csv'); });
  byId('pdf-confirmed').addEventListener('change', (event) => { byId('download-pdf-report').disabled = !event.target.checked; });
  byId('download-pdf-report').addEventListener('click', () => download('sbi-pdf-format-report.json', JSON.stringify(pdfReport, null, 2) + '\n', 'application/json'));
})();
