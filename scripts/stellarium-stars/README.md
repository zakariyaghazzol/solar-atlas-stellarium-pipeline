# Pipeline implementation

The Node.js implementation is split into three files:

- `convert.mjs` discovers selected catalogs, streams their records, and writes runtime binaries plus a manifest.
- `lib.mjs` contains the binary-format parsing, record conversion, manifest, and scan functions.
- `validate.mjs` independently re-reads source metadata and checks output sizes and known HIP-star fixtures.

Run all commands from the repository root. Paths may be supplied with either `--option value` or `--option=value`.

```powershell
npm run convert -- --source="C:\path\to\hip_gaia3" --out="build\stellarium-stars"
npm run validate -- --source="C:\path\to\hip_gaia3" --out="build\stellarium-stars"
```

The current implementation deliberately accepts only Stellarium type-0, major-version-0, 48-byte star records. Unsupported layouts are reported and skipped rather than guessed.
