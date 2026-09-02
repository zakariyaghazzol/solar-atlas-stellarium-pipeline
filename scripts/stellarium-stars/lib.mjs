import fsp from "node:fs/promises";
import path from "node:path";

export const FILE_MAGIC = 0x835f040a;
export const SOURCE_HEADER_BYTES = 28;
export const TYPE0_RECORD_BYTES = 48;
export const RUNTIME_RECORD_BYTES = 32;
export const STAR_CATALOG_EPOCH_JD = 2457389.0;
export const DEFAULT_SOURCE_DIR = path.resolve("data", "source");
export const DEFAULT_OUTPUT_DIR = path.resolve("build", "stellarium-stars");
export const DEFAULT_FIXTURE_PATH = path.resolve(
  "scripts",
  "stellarium-stars",
  "validation-fixture.json"
);
export const DEFAULT_CONFIG_FILE = "defaultStarsConfig.json";

export function parseCliArgs(argv) {
  const args = {
    sourceDir: DEFAULT_SOURCE_DIR,
    outputDir: DEFAULT_OUTPUT_DIR,
    fixturePath: DEFAULT_FIXTURE_PATH,
    selectedCatalogIds: [],
    includeUnchecked: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--source" && argv[index + 1]) {
      args.sourceDir = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token.startsWith("--source=")) {
      args.sourceDir = path.resolve(token.slice("--source=".length));
      continue;
    }
    if (token === "--out" && argv[index + 1]) {
      args.outputDir = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      args.outputDir = path.resolve(token.slice("--out=".length));
      continue;
    }
    if (token === "--fixture" && argv[index + 1]) {
      args.fixturePath = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token.startsWith("--fixture=")) {
      args.fixturePath = path.resolve(token.slice("--fixture=".length));
      continue;
    }
    if (token === "--catalog" && argv[index + 1]) {
      args.selectedCatalogIds.push(...splitCatalogIds(argv[index + 1]));
      index += 1;
      continue;
    }
    if (token.startsWith("--catalog=")) {
      args.selectedCatalogIds.push(...splitCatalogIds(token.slice("--catalog=".length)));
      continue;
    }
    if (token === "--include-unchecked") {
      args.includeUnchecked = true;
      continue;
    }
  }

  args.selectedCatalogIds = Array.from(new Set(args.selectedCatalogIds));
  return args;
}

function splitCatalogIds(value) {
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function readDefaultStarsConfig(sourceDir) {
  const configPath = path.join(sourceDir, DEFAULT_CONFIG_FILE);
  const configText = await fsp.readFile(configPath, "utf8");
  return {
    configPath,
    config: JSON.parse(configText)
  };
}

export async function discoverCatalogs(sourceDir, config) {
  const catalogs = [];
  for (const catalog of config.catalogs || []) {
    const absolutePath = path.join(sourceDir, catalog.fileName);
    let fileStat = null;
    try {
      fileStat = await fsp.stat(absolutePath);
    } catch {
      fileStat = null;
    }
    catalogs.push({
      ...catalog,
      absolutePath,
      exists: Boolean(fileStat && fileStat.isFile()),
      sizeBytes: fileStat && fileStat.isFile() ? fileStat.size : null
    });
  }
  return catalogs;
}

export function selectCatalogs(discoveredCatalogs, options = {}) {
  const selectedSet = new Set(options.selectedCatalogIds || []);
  const includeUnchecked = Boolean(options.includeUnchecked);
  return discoveredCatalogs.filter((catalog) => {
    if (!catalog.exists) {
      return false;
    }
    if (selectedSet.size > 0) {
      return selectedSet.has(catalog.id);
    }
    return includeUnchecked ? true : Boolean(catalog.checked);
  });
}

export function computeZoneCount(level) {
  return 20 * (4 ** level) + 1;
}

export async function readCatalogHeader(filePath) {
  const handle = await fsp.open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(SOURCE_HEADER_BYTES);
    await handle.read(buffer, 0, buffer.length, 0);
    return parseCatalogHeaderBuffer(buffer);
  } finally {
    await handle.close();
  }
}

export function parseCatalogHeaderBuffer(buffer) {
  return {
    magic: buffer.readUInt32LE(0),
    dataType: buffer.readUInt32LE(4),
    majorVersion: buffer.readUInt32LE(8),
    minorVersion: buffer.readUInt32LE(12),
    level: buffer.readUInt32LE(16),
    magnitudeMinimumMilli: buffer.readInt32LE(20),
    catalogEpochJulianDay: buffer.readFloatLE(24)
  };
}

export async function readZoneCounts(filePath, level) {
  const zoneCount = computeZoneCount(level);
  const buffer = Buffer.allocUnsafe(zoneCount * 4);
  const handle = await fsp.open(filePath, "r");
  try {
    await handle.read(buffer, 0, buffer.length, SOURCE_HEADER_BYTES);
  } finally {
    await handle.close();
  }

  const zoneCounts = new Uint32Array(zoneCount);
  let recordCount = 0;
  for (let index = 0; index < zoneCount; index += 1) {
    const value = buffer.readUInt32LE(index * 4);
    zoneCounts[index] = value;
    recordCount += value;
  }

  return {
    zoneCount,
    zoneCounts,
    recordCount,
    starDataOffset: SOURCE_HEADER_BYTES + buffer.length
  };
}

export function decodeType0Record(buffer, offset = 0) {
  const gaiaSigned = buffer.readBigInt64LE(offset);
  const gaiaUnsigned = BigInt.asUintN(64, gaiaSigned);
  const x0 = buffer.readInt32LE(offset + 8) / 2e9;
  const x1 = buffer.readInt32LE(offset + 12) / 2e9;
  const x2 = buffer.readInt32LE(offset + 16) / 2e9;
  const dx0 = buffer.readInt32LE(offset + 20) / 1000;
  const dx1 = buffer.readInt32LE(offset + 24) / 1000;
  const dx2 = buffer.readInt32LE(offset + 28) / 1000;
  const bvMilli = buffer.readInt16LE(offset + 32);
  const magMilli = buffer.readInt16LE(offset + 34);
  const parallaxMas = buffer.readUInt16LE(offset + 36) * 0.02;
  const parallaxErrorMas = buffer.readUInt16LE(offset + 38) * 0.01;
  const radialVelocityKmS = buffer.readInt16LE(offset + 40) / 10;
  const spectralIndex = buffer.readUInt16LE(offset + 42);
  const objectTypeIndex = buffer.readUInt8(offset + 44);
  const hipPacked =
    buffer.readUInt8(offset + 45) |
    (buffer.readUInt8(offset + 46) << 8) |
    (buffer.readUInt8(offset + 47) << 16);
  const hip = hipPacked >>> 5;
  const componentId = hipPacked & 0x1f;
  const length = Math.hypot(x0, x1, x2) || 1;

  return {
    gaiaId: gaiaUnsigned,
    gaiaLow: Number(gaiaUnsigned & 0xffffffffn),
    gaiaHigh: Number((gaiaUnsigned >> 32n) & 0xffffffffn),
    hip,
    componentId,
    spectralIndex,
    objectTypeIndex,
    magMilli,
    bvMilli,
    parallaxMas,
    parallaxErrorMas,
    radialVelocityKmS,
    direction: {
      x: x0 / length,
      y: x1 / length,
      z: x2 / length
    },
    rawCartesian: {
      x: x0,
      y: x1,
      z: x2
    },
    properMotionMasYr: {
      x: dx0,
      y: dx1,
      z: dx2
    }
  };
}

export function writeRuntimeType0Record(buffer, offset, star) {
  buffer.writeFloatLE(star.direction.x, offset + 0);
  buffer.writeFloatLE(star.direction.y, offset + 4);
  buffer.writeFloatLE(star.direction.z, offset + 8);
  buffer.writeInt16LE(star.magMilli, offset + 12);
  buffer.writeInt16LE(star.bvMilli, offset + 14);
  buffer.writeUInt32LE(star.hip >>> 0, offset + 16);
  buffer.writeUInt32LE(star.gaiaLow >>> 0, offset + 20);
  buffer.writeUInt32LE(star.gaiaHigh >>> 0, offset + 24);
  buffer.writeUInt8(star.componentId & 0xff, offset + 28);
  buffer.writeUInt8(star.objectTypeIndex & 0xff, offset + 29);
  buffer.writeUInt16LE(star.spectralIndex & 0xffff, offset + 30);
}

export async function convertType0Catalog(catalog, outputDir, options = {}) {
  const header = await readCatalogHeader(catalog.absolutePath);
  if (header.magic !== FILE_MAGIC) {
    throw new Error(`${catalog.fileName}: unsupported magic 0x${header.magic.toString(16)}`);
  }
  if (header.dataType !== 0 || header.majorVersion !== 0) {
    throw new Error(
      `${catalog.fileName}: only type-0 major-version-0 catalogs are supported in this converter`
    );
  }

  const zoneInfo = await readZoneCounts(catalog.absolutePath, header.level);
  const outputCatalogDir = path.join(outputDir, "catalogs");
  await fsp.mkdir(outputCatalogDir, { recursive: true });
  const outputFile = path.join(outputCatalogDir, `${catalog.id}.bin`);
  const sourceHandle = await fsp.open(catalog.absolutePath, "r");
  const outputHandle = await fsp.open(outputFile, "w");
  const chunkRecords = Math.max(512, Number(options.chunkRecords) || 4096);
  const sourceChunk = Buffer.allocUnsafe(chunkRecords * TYPE0_RECORD_BYTES);
  const outputChunk = Buffer.allocUnsafe(chunkRecords * RUNTIME_RECORD_BYTES);

  let currentZoneIndex = 0;
  let starsRemainingInZone = zoneInfo.zoneCounts[0] || 0;
  let readRecords = 0;
  let magMin = Number.POSITIVE_INFINITY;
  let magMax = Number.NEGATIVE_INFINITY;
  let bvMin = Number.POSITIVE_INFINITY;
  let bvMax = Number.NEGATIVE_INFINITY;
  let hipCount = 0;
  let gaiaCount = 0;
  let brightest = null;

  try {
    while (readRecords < zoneInfo.recordCount) {
      const batchCount = Math.min(chunkRecords, zoneInfo.recordCount - readRecords);
      const sourceBytes = batchCount * TYPE0_RECORD_BYTES;
      await sourceHandle.read(
        sourceChunk,
        0,
        sourceBytes,
        zoneInfo.starDataOffset + (readRecords * TYPE0_RECORD_BYTES)
      );

      for (let index = 0; index < batchCount; index += 1) {
        while (starsRemainingInZone === 0 && currentZoneIndex < zoneInfo.zoneCounts.length - 1) {
          currentZoneIndex += 1;
          starsRemainingInZone = zoneInfo.zoneCounts[currentZoneIndex];
        }

        const sourceOffset = index * TYPE0_RECORD_BYTES;
        const outputOffset = index * RUNTIME_RECORD_BYTES;
        const star = decodeType0Record(sourceChunk, sourceOffset);
        writeRuntimeType0Record(outputChunk, outputOffset, star);

        if (star.hip > 0) {
          hipCount += 1;
        }
        if (star.gaiaId > 0n) {
          gaiaCount += 1;
        }
        if (star.magMilli < magMin) {
          magMin = star.magMilli;
        }
        if (star.magMilli > magMax) {
          magMax = star.magMilli;
        }
        if (star.bvMilli < bvMin) {
          bvMin = star.bvMilli;
        }
        if (star.bvMilli > bvMax) {
          bvMax = star.bvMilli;
        }
        if (!brightest || star.magMilli < brightest.magMilli) {
          brightest = {
            hip: star.hip,
            gaiaId: star.gaiaId.toString(),
            magMilli: star.magMilli
          };
        }

        starsRemainingInZone = Math.max(0, starsRemainingInZone - 1);
      }

      await outputHandle.write(outputChunk, 0, batchCount * RUNTIME_RECORD_BYTES);
      readRecords += batchCount;
    }
  } finally {
    await sourceHandle.close();
    await outputHandle.close();
  }

  return {
    id: catalog.id,
    fileName: catalog.fileName,
    outputFile: path.relative(outputDir, outputFile).replace(/\\/g, "/"),
    header,
    zoneCount: zoneInfo.zoneCount,
    recordCount: zoneInfo.recordCount,
    sourceRecordBytes: TYPE0_RECORD_BYTES,
    runtimeRecordBytes: RUNTIME_RECORD_BYTES,
    sourceSizeBytes: catalog.sizeBytes,
    outputSizeBytes: zoneInfo.recordCount * RUNTIME_RECORD_BYTES,
    starDataOffset: zoneInfo.starDataOffset,
    stats: {
      magMilli: {
        min: Number.isFinite(magMin) ? magMin : null,
        max: Number.isFinite(magMax) ? magMax : null
      },
      bvMilli: {
        min: Number.isFinite(bvMin) ? bvMin : null,
        max: Number.isFinite(bvMax) ? bvMax : null
      },
      hipCount,
      gaiaCount,
      brightest
    }
  };
}

export async function writeManifest(outputDir, manifest) {
  await fsp.mkdir(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, "manifest.json");
  const text = JSON.stringify(manifest, null, 2);
  await fsp.writeFile(manifestPath, `${text}\n`, "utf8");
  return manifestPath;
}

export async function loadManifest(outputDir) {
  const manifestPath = path.join(outputDir, "manifest.json");
  const text = await fsp.readFile(manifestPath, "utf8");
  return {
    manifestPath,
    manifest: JSON.parse(text)
  };
}

export async function scanRuntimeCatalogForHip(outputFile, hipTargets) {
  const targets = new Set(hipTargets);
  const matches = new Map();
  const handle = await fsp.open(outputFile, "r");
  const chunkRecords = 4096;
  const buffer = Buffer.allocUnsafe(chunkRecords * RUNTIME_RECORD_BYTES);

  try {
    let position = 0;
    while (targets.size > 0) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead <= 0) {
        break;
      }
      const recordsRead = Math.floor(bytesRead / RUNTIME_RECORD_BYTES);
      for (let index = 0; index < recordsRead; index += 1) {
        const offset = index * RUNTIME_RECORD_BYTES;
        const hip = buffer.readUInt32LE(offset + 16);
        if (!targets.has(hip)) {
          continue;
        }
        const x = buffer.readFloatLE(offset + 0);
        const y = buffer.readFloatLE(offset + 4);
        const z = buffer.readFloatLE(offset + 8);
        matches.set(hip, {
          hip,
          magMilli: buffer.readInt16LE(offset + 12),
          bvMilli: buffer.readInt16LE(offset + 14),
          direction: [x, y, z],
          componentId: buffer.readUInt8(offset + 28),
          objectTypeIndex: buffer.readUInt8(offset + 29),
          spectralIndex: buffer.readUInt16LE(offset + 30),
          gaiaLow: buffer.readUInt32LE(offset + 20),
          gaiaHigh: buffer.readUInt32LE(offset + 24)
        });
        targets.delete(hip);
      }
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }

  return matches;
}

export async function ensureDirectory(directoryPath) {
  await fsp.mkdir(directoryPath, { recursive: true });
}

export function formatCatalogSummary(catalog) {
  return `${catalog.id} (${catalog.fileName}) records=${catalog.recordCount} level=${catalog.header.level}`;
}

