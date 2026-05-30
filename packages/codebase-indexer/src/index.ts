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
export {
  CodebaseQueryReader,
  parseQueryLimit,
  MAX_QUERY_LIMIT,
  DEFAULT_QUERY_LIMIT,
  type PaginatedResult,
  type CodeFileRow,
  type CodeRouteRow,
  type CodeSymbolRow,
  type CodeDependencyRow,
  type CodebaseSearchResult,
} from "./query-reader.js";
export {
  isSafeQueryPath,
  filterSafePaths,
  SAFE_CODE_FILE_PATH_SQL,
  ignoredDirPathMatchSql,
} from "./security-path.js";
export {
  handleCodebaseSearch,
  type CodebaseSearchToolInput,
  type CodebaseSearchToolResult,
} from "./search-handler.js";
export {
  parseSearchKind,
  SEARCH_KINDS,
  InvalidSearchKindError,
  type SearchKind,
} from "./search-kind.js";
export {
  CodebaseMemoryActivator,
  buildCodebaseSearchQuery,
  countActivationBlockItems,
  extractCodebaseSearchTerms,
  formatCodebaseActivationBlock,
  isCodebaseActivationEnabled,
  resolveCodebaseActivationLimit,
  trimActivationSearchResult,
  MAX_ACTIVATION_BLOCK_ITEMS,
  DEFAULT_ACTIVATION_LIMIT,
} from "./codebase-activator.js";
