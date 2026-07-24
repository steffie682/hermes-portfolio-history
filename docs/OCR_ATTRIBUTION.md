# Browser OCR attribution

The SBI balance-report inspector uses:

- `tesseract.js` 7.0.0 (Apache-2.0)
- `tesseract.js-core` 7.0.0 (Apache-2.0), installed as a direct pinned dependency
- `@tesseract.js-data/jpn` 1.0.0 and its Japanese trained data (MIT)

The build preparation script copies only the browser worker, six LSTM core
assets (three `.wasm.js` loaders and their three `.wasm` binaries), and
`4.0.0_best_int/jpn.traineddata.gz` into the generated `public/ocr/` directory.
Package license files remain available in the pinned npm distributions and are
not modified.
