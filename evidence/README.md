# Verification evidence

`verified-run-manifest.json` is a sanitized manifest preserved from the April 3, 2026 Solar Atlas conversion run. It records the source headers, decoded record counts, runtime layout, byte totals, magnitude and color-index ranges, and conversion statistics without bundling the source catalogs or generated binaries.

That run converted four locally available type-0 catalogs:

- 586,525 records
- 28,160,128 source bytes
- 18,768,800 runtime bytes
- 48-byte source records converted to 32-byte runtime records
- approximately 33.3% total byte reduction

The public test suite uses generated synthetic records so the parser and conversion path can be checked without redistributing third-party catalog data.
