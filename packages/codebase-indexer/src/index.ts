export type {
  IndexOptions,
  IndexResult,
  ParsedFile,
  ParsedImport,
  ParsedRoute,
  ParsedSymbol,
  ScannedFile,
  SymbolKind,
} from "./types.js";

export { scanCodebase } from "./scanner.js";
export { sha256Content } from "./hash.js";
export { parseFile, parseSourceFile, detectFastifyRoutes } from "./parser.js";
export {
  CodebaseIndexer,
  countIndexedFiles,
  hasIgnoredPathIndexed,
  hasSecretPathIndexed,
  isCodeFileIndexed,
} from "./indexer.js";
export {
  indexSemanticChunks,
  countSemanticCodeChunks,
  stableFileSourceId,
  stableSymbolSourceId,
  stableRouteSourceId,
} from "./semantic.js";
export {
  shouldIgnoreDirectory,
  shouldIgnoreFile,
  shouldIgnoreFileName,
  isIndexableSourceFile,
  resolveMaxFileBytes,
  isBinaryBuffer,
  DEFAULT_IGNORED_DIRS,
  DEFAULT_IGNORED_FILE_PATTERNS,
  DEFAULT_MAX_FILE_BYTES,
} from "./ignore.js";
export type { ScanOptions } from "./scanner.js";
