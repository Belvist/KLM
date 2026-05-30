import { open, readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { ScannedFile } from "./types.js";
import {
  binaryProbeByteCount,
  isBinaryBuffer,
  isIndexableSourceFile,
  resolveMaxFileBytes,
  shouldIgnoreDirectory,
  shouldIgnoreFile,
} from "./ignore.js";

export interface ScanOptions {
  maxFileBytes?: number;
}

async function readFileHeader(absolutePath: string, maxBytes: number): Promise<Buffer> {
  const fh = await open(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function walkDirectory(
  root: string,
  currentDir: string,
  files: ScannedFile[],
  maxFileBytes: number
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = join(currentDir, entry.name);

    if (entry.isDirectory()) {
      if (shouldIgnoreDirectory(entry.name)) continue;
      await walkDirectory(root, absolutePath, files, maxFileBytes);
      continue;
    }

    if (!entry.isFile()) continue;

    const relativePath = relative(root, absolutePath).replace(/\\/g, "/");
    if (shouldIgnoreFile(relativePath)) continue;
    if (!isIndexableSourceFile(relativePath)) continue;

    const fileStat = await stat(absolutePath);
    if (fileStat.size > maxFileBytes) continue;

    const header = await readFileHeader(absolutePath, binaryProbeByteCount());
    if (isBinaryBuffer(header)) continue;

    const content = await readFile(absolutePath, "utf-8");
    files.push({ relativePath, absolutePath, content });
  }
}

export async function scanCodebase(
  rootPath: string,
  options?: ScanOptions
): Promise<ScannedFile[]> {
  const root = resolve(rootPath);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`Root path is not a directory: ${root}`);
  }

  const maxFileBytes = options?.maxFileBytes ?? resolveMaxFileBytes();
  const files: ScannedFile[] = [];
  await walkDirectory(root, root, files, maxFileBytes);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return files;
}
