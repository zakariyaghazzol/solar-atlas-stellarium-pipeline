# Solar Atlas - Stellarium Catalog Pipeline

A dependency-free Node.js pipeline that converts Stellarium type-0 star catalogs into a compact binary layout designed for real-time Babylon.js rendering, then validates record counts, byte sizes, known HIP stars, magnitudes, color indices, and normalized direction vectors.

This repository contains the catalog conversion and validation components used by **Solar Atlas**. The visualization application, Stellarium installation, downloaded catalogs, and generated runtime binaries are not included.

## What it does

```text
defaultStarsConfig.json + catalog files
                  |
                  v
       header and zone-count parser
                  |
                  v
    chunked 48-byte record conversion
                  |
                  v
  32-byte Babylon.js runtime records + manifest
                  |
                  v
   count, size, HIP, magnitude, B-V, and vector validation
```

The converter:

- reads the 28-byte catalog header and validates the file magic and supported layout;
- computes geodesic zone counts and decodes per-zone record totals;
- processes records in bounded chunks instead of loading a full catalog into memory;
- preserves normalized direction, magnitude, B-V color index, HIP/Gaia identifiers, component ID, object type, and spectral index;
- emits a machine-readable manifest describing every converted or skipped catalog;
- rejects unsupported catalog layouts rather than silently guessing.

## Verified Solar Atlas run

The preserved April 3, 2026 manifest records:

| Result | Value |
|---|---:|
| Catalogs converted | 4 |
| Source records | 586,525 |
| Source bytes | 28,160,128 |
| Runtime bytes | 18,768,800 |
| Record layout | 48 bytes -> 32 bytes |
| Total reduction | approximately 33.3% |

See [`evidence/verified-run-manifest.json`](evidence/verified-run-manifest.json) for the catalog-by-catalog results. The source catalogs and converted binaries are deliberately excluded.

## Requirements

- Node.js 20 or later
- A local `defaultStarsConfig.json`
- Locally obtained compatible catalog files

No npm dependencies are required. The `"private": true` package setting prevents accidental npm publication; it does not control GitHub repository visibility.

## Run the public tests

```powershell
npm test
npm run check
```

The tests generate a miniature valid catalog in a temporary directory, exercise the command-line converter and validator, verify the compact output records, and delete the temporary data afterward.

## Convert local catalogs

```powershell
npm run convert -- --source="C:\path\to\hip_gaia3" --out="build\stellarium-stars"
npm run validate -- --source="C:\path\to\hip_gaia3" --out="build\stellarium-stars"
```

You can select individual catalog IDs:

```powershell
npm run convert -- --source="C:\path\to\hip_gaia3" --catalog=stars0,stars1
```

By default, only locally present catalogs marked `checked` in the configuration are converted. Use `--include-unchecked` to include other locally present entries.

## Runtime record layout

| Offset | Field | Type |
|---:|---|---|
| 0 | normalized x | float32 |
| 4 | normalized y | float32 |
| 8 | normalized z | float32 |
| 12 | magnitude x1000 | int16 |
| 14 | B-V x1000 | int16 |
| 16 | HIP identifier | uint32 |
| 20 | Gaia identifier, low word | uint32 |
| 24 | Gaia identifier, high word | uint32 |
| 28 | component ID | uint8 |
| 29 | object-type index | uint8 |
| 30 | spectral index | uint16 |

## Scope and limitations

- Supported input: data type 0, major version 0, 48-byte records.
- Proper motion, parallax, and radial velocity are decoded for inspection but are not retained in the compact runtime layout.
- The validator's default known-star fixture expects the same locally obtained catalogs used for the recorded Solar Atlas run.
- This is a data pipeline, not an authoritative astronomical-analysis package.

## Licensing and data

Original code in this repository is available under the MIT License. No Stellarium binaries, catalogs, or application assets are included. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) before using or redistributing third-party data.
