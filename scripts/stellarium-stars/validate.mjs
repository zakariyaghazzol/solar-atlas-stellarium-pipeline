import fsp from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_OUTPUT_DIR,
  discoverCatalogs,
  loadManifest,
  parseCliArgs,
  readDefaultStarsConfig,
  readCatalogHeader,
  readZoneCounts,
  scanRuntimeCatalogForHip
} from "./lib.mjs";

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const outputDir = args.outputDir || DEFAULT_OUTPUT_DIR;
  const { manifestPath, manifest } = await loadManifest(outputDir);
  const { config } = await readDefaultStarsConfig(args.sourceDir);
  const discoveredCatalogs = await discoverCatalogs(args.sourceDir, config);
  const discoveredById = new Map(discoveredCatalogs.map((catalog) => [catalog.id, catalog]));
  const issues = [];

  for (const catalog of manifest.convertedCatalogs || []) {
    const sourceCatalog = discoveredById.get(catalog.id);
    if (!sourceCatalog || !sourceCatalog.exists) {
      issues.push(`${catalog.id}: source catalog missing`);
      continue;
    }

    const header = await readCatalogHeader(sourceCatalog.absolutePath);
    const zoneInfo = await readZoneCounts(sourceCatalog.absolutePath, header.level);
    if (zoneInfo.recordCount !== catalog.recordCount) {
      issues.push(`${catalog.id}: decoded count ${zoneInfo.recordCount} did not match manifest ${catalog.recordCount}`);
    }

    const outputFile = path.join(outputDir, catalog.outputFile);
    let outputStat = null;
    try {
      outputStat = await fsp.stat(outputFile);
    } catch {
      issues.push(`${catalog.id}: runtime output file missing (${outputFile})`);
      continue;
    }

    const expectedBytes = catalog.recordCount * manifest.runtimeRecordLayout.bytesPerRecord;
    if (outputStat.size !== expectedBytes) {
      issues.push(`${catalog.id}: runtime output size ${outputStat.size} did not match expected ${expectedBytes}`);
    }

    console.log(`[validate] ${catalog.id} sourceCount=${zoneInfo.recordCount} outputBytes=${outputStat.size}`);
  }

  const fixture = JSON.parse(await fsp.readFile(args.fixturePath, "utf8"));
  const fixtureByCatalog = new Map();
  for (const item of fixture.knownHipStars || []) {
    if (!fixtureByCatalog.has(item.catalogId)) {
      fixtureByCatalog.set(item.catalogId, []);
    }
    fixtureByCatalog.get(item.catalogId).push(item);
  }

  for (const [catalogId, expectedStars] of fixtureByCatalog.entries()) {
    const manifestCatalog = (manifest.convertedCatalogs || []).find((catalog) => catalog.id === catalogId);
    if (!manifestCatalog) {
      issues.push(`${catalogId}: missing from converted catalogs, cannot validate known HIP stars`);
      continue;
    }
    const outputFile = path.join(outputDir, manifestCatalog.outputFile);
    const matches = await scanRuntimeCatalogForHip(
      outputFile,
      expectedStars.map((entry) => entry.hip)
    );

    for (const expected of expectedStars) {
      const actual = matches.get(expected.hip);
      if (!actual) {
        issues.push(`${catalogId}: HIP ${expected.hip} not found in runtime output`);
        continue;
      }
      if (actual.magMilli !== expected.magMilli) {
        issues.push(`${catalogId}: HIP ${expected.hip} mag ${actual.magMilli} did not match ${expected.magMilli}`);
      }
      if (actual.bvMilli !== expected.bvMilli) {
        issues.push(`${catalogId}: HIP ${expected.hip} B-V ${actual.bvMilli} did not match ${expected.bvMilli}`);
      }
      const norm = Math.hypot(...actual.direction);
      if (Math.abs(norm - 1) > fixture.tolerance.unitLength) {
        issues.push(`${catalogId}: HIP ${expected.hip} direction norm ${norm} drifted beyond tolerance`);
      }
      for (let axis = 0; axis < 3; axis += 1) {
        if (Math.abs(actual.direction[axis] - expected.direction[axis]) > fixture.tolerance.direction) {
          issues.push(
            `${catalogId}: HIP ${expected.hip} direction[${axis}] ${actual.direction[axis]} did not match ${expected.direction[axis]}`
          );
        }
      }
      console.log(
        `[validate] HIP ${expected.hip} mag=${actual.magMilli} dir=${actual.direction.map((value) => value.toFixed(6)).join(",")}`
      );
    }
  }

  if (issues.length > 0) {
    console.error(`[validate] failed with ${issues.length} issue(s)`);
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`[validate] manifest ${manifestPath}`);
  console.log("[validate] all checks passed");
}

main().catch((error) => {
  console.error(`[validate] failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exitCode = 1;
});

