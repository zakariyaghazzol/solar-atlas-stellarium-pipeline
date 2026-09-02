import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  FILE_MAGIC,
  RUNTIME_RECORD_BYTES,
  computeZoneCount,
  parseCliArgs,
  scanRuntimeCatalogForHip
} from "../scripts/stellarium-stars/lib.mjs";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..");
const CONVERTER = path.join(REPOSITORY_ROOT, "scripts", "stellarium-stars", "convert.mjs");
const VALIDATOR = path.join(REPOSITORY_ROOT, "scripts", "stellarium-stars", "validate.mjs");

function writeSourceRecord(buffer, offset, star) {
  buffer.writeBigUInt64LE(BigInt(star.gaiaId), offset);
  buffer.writeInt32LE(Math.round(star.vector[0] * 2e9), offset + 8);
  buffer.writeInt32LE(Math.round(star.vector[1] * 2e9), offset + 12);
  buffer.writeInt32LE(Math.round(star.vector[2] * 2e9), offset + 16);
  buffer.writeInt32LE(0, offset + 20);
  buffer.writeInt32LE(0, offset + 24);
  buffer.writeInt32LE(0, offset + 28);
  buffer.writeInt16LE(star.bvMilli, offset + 32);
  buffer.writeInt16LE(star.magMilli, offset + 34);
  buffer.writeUInt16LE(0, offset + 36);
  buffer.writeUInt16LE(0, offset + 38);
  buffer.writeInt16LE(0, offset + 40);
  buffer.writeUInt16LE(star.spectralIndex, offset + 42);
  buffer.writeUInt8(star.objectTypeIndex, offset + 44);
  buffer.writeUIntLE((star.hip << 5) | star.componentId, offset + 45, 3);
}

async function createSyntheticCatalog(root) {
  const sourceDir = path.join(root, "source");
  const outputDir = path.join(root, "output");
  const fixturePath = path.join(root, "fixture.json");
  await fsp.mkdir(sourceDir, { recursive: true });

  const stars = [
    {
      gaiaId: 1234567890123456789n,
      vector: [1, 0, 0],
      bvMilli: 120,
      magMilli: 1500,
      hip: 11767,
      componentId: 1,
      objectTypeIndex: 2,
      spectralIndex: 33
    },
    {
      gaiaId: 987654321012345678n,
      vector: [0, 0.6, 0.8],
      bvMilli: -30,
      magMilli: 80,
      hip: 24436,
      componentId: 0,
      objectTypeIndex: 4,
      spectralIndex: 71
    }
  ];

  const level = 0;
  const zoneCount = computeZoneCount(level);
  const header = Buffer.alloc(28);
  header.writeUInt32LE(FILE_MAGIC, 0);
  header.writeUInt32LE(0, 4);
  header.writeUInt32LE(0, 8);
  header.writeUInt32LE(1, 12);
  header.writeUInt32LE(level, 16);
  header.writeInt32LE(-2000, 20);
  header.writeFloatLE(2457389.0, 24);

  const zoneCounts = Buffer.alloc(zoneCount * 4);
  zoneCounts.writeUInt32LE(stars.length, 0);
  const records = Buffer.alloc(stars.length * 48);
  stars.forEach((star, index) => writeSourceRecord(records, index * 48, star));

  const fileName = "synthetic_0_0v0_1.cat";
  await fsp.writeFile(path.join(sourceDir, fileName), Buffer.concat([header, zoneCounts, records]));
  await fsp.writeFile(
    path.join(sourceDir, "defaultStarsConfig.json"),
    `${JSON.stringify({ catalogs: [{ id: "synthetic", fileName, checked: true }] }, null, 2)}\n`
  );
  await fsp.writeFile(
    fixturePath,
    `${JSON.stringify(
      {
        tolerance: { direction: 0.000001, unitLength: 0.0001 },
        knownHipStars: stars.map((star) => ({
          catalogId: "synthetic",
          hip: star.hip,
          magMilli: star.magMilli,
          bvMilli: star.bvMilli,
          direction: star.vector
        }))
      },
      null,
      2
    )}\n`
  );

  return { sourceDir, outputDir, fixturePath, stars };
}

test("portable CLI arguments use caller-provided paths", () => {
  const parsed = parseCliArgs([
    "--source=fixtures/source",
    "--out",
    "fixtures/output",
    "--fixture=fixtures/known-stars.json",
    "--catalog=stars0,stars1"
  ]);
  assert.equal(parsed.sourceDir, path.resolve("fixtures/source"));
  assert.equal(parsed.outputDir, path.resolve("fixtures/output"));
  assert.equal(parsed.fixturePath, path.resolve("fixtures/known-stars.json"));
  assert.deepEqual(parsed.selectedCatalogIds, ["stars0", "stars1"]);
});

test("converter and validator process a generated type-0 catalog end to end", async (context) => {
  const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "solar-atlas-pipeline-"));
  context.after(() => fsp.rm(temporaryRoot, { recursive: true, force: true }));
  const { sourceDir, outputDir, fixturePath, stars } = await createSyntheticCatalog(temporaryRoot);

  const convertResult = await execFileAsync(
    process.execPath,
    [CONVERTER, `--source=${sourceDir}`, `--out=${outputDir}`],
    { cwd: REPOSITORY_ROOT }
  );
  assert.match(convertResult.stdout, /converted 1 catalog\(s\)/);

  const validateResult = await execFileAsync(
    process.execPath,
    [VALIDATOR, `--source=${sourceDir}`, `--out=${outputDir}`, `--fixture=${fixturePath}`],
    { cwd: REPOSITORY_ROOT }
  );
  assert.match(validateResult.stdout, /all checks passed/);

  const outputFile = path.join(outputDir, "catalogs", "synthetic.bin");
  const outputStat = await fsp.stat(outputFile);
  assert.equal(outputStat.size, stars.length * RUNTIME_RECORD_BYTES);

  const matches = await scanRuntimeCatalogForHip(
    outputFile,
    stars.map((star) => star.hip)
  );
  assert.equal(matches.size, stars.length);
  assert.equal(matches.get(11767).magMilli, 1500);
  assert.equal(matches.get(24436).bvMilli, -30);
  assert.ok(Math.abs(Math.hypot(...matches.get(24436).direction) - 1) < 0.0001);
});
