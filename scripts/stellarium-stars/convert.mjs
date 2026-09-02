import path from "node:path";

import {
  DEFAULT_OUTPUT_DIR,
  convertType0Catalog,
  discoverCatalogs,
  ensureDirectory,
  formatCatalogSummary,
  parseCliArgs,
  readDefaultStarsConfig,
  selectCatalogs,
  writeManifest
} from "./lib.mjs";

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const { configPath, config } = await readDefaultStarsConfig(args.sourceDir);
  const discoveredCatalogs = await discoverCatalogs(args.sourceDir, config);
  const selectedCatalogs = selectCatalogs(discoveredCatalogs, args);
  const convertedCatalogs = [];
  const skippedCatalogs = [];

  await ensureDirectory(args.outputDir);

  for (const catalog of selectedCatalogs) {
    try {
      const converted = await convertType0Catalog(catalog, args.outputDir);
      convertedCatalogs.push(converted);
      console.log(`[convert] ${formatCatalogSummary(converted)}`);
    } catch (error) {
      skippedCatalogs.push({
        id: catalog.id,
        fileName: catalog.fileName,
        reason: error instanceof Error ? error.message : String(error)
      });
      console.warn(`[convert] skipped ${catalog.id}: ${skippedCatalogs.at(-1).reason}`);
    }
  }

  for (const catalog of discoveredCatalogs) {
    if (!catalog.exists) {
      skippedCatalogs.push({
        id: catalog.id,
        fileName: catalog.fileName,
        reason: "catalog file not present locally"
      });
      continue;
    }
    if (!selectedCatalogs.some((selected) => selected.id === catalog.id)) {
      skippedCatalogs.push({
        id: catalog.id,
        fileName: catalog.fileName,
        reason: "not selected for conversion"
      });
    }
  }

  const manifest = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceRoot: path.relative(process.cwd(), args.sourceDir).replace(/\\/g, "/"),
    configFile: path.relative(process.cwd(), configPath).replace(/\\/g, "/"),
    runtimeRecordLayout: {
      bytesPerRecord: 32,
      fields: [
        { name: "x", type: "float32", offset: 0 },
        { name: "y", type: "float32", offset: 4 },
        { name: "z", type: "float32", offset: 8 },
        { name: "magMilli", type: "int16", offset: 12 },
        { name: "bvMilli", type: "int16", offset: 14 },
        { name: "hip", type: "uint32", offset: 16 },
        { name: "gaiaLow", type: "uint32", offset: 20 },
        { name: "gaiaHigh", type: "uint32", offset: 24 },
        { name: "componentId", type: "uint8", offset: 28 },
        { name: "objectTypeIndex", type: "uint8", offset: 29 },
        { name: "spectralIndex", type: "uint16", offset: 30 }
      ]
    },
    discoveredCatalogs: discoveredCatalogs.map((catalog) => ({
      id: catalog.id,
      fileName: catalog.fileName,
      checked: Boolean(catalog.checked),
      exists: Boolean(catalog.exists),
      sizeBytes: catalog.sizeBytes,
      magRange: catalog.magRange || null
    })),
    convertedCatalogs,
    skippedCatalogs
  };

  const manifestPath = await writeManifest(args.outputDir, manifest);
  console.log(`[convert] manifest ${manifestPath}`);
  console.log(`[convert] converted ${convertedCatalogs.length} catalog(s)`);
}

main().catch((error) => {
  console.error(`[convert] failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exitCode = 1;
});

