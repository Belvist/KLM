export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "method";

export interface ScannedFile {
  relativePath: string;
  absolutePath: string;
  content: string;
}

export interface ParsedImport {
  targetModule: string;
  importKind: "import" | "export-from" | "require";
}

export interface ParsedSymbol {
  symbolType: SymbolKind;
  name: string;
  exported: boolean;
  lineStart?: number;
  lineEnd?: number;
  signature?: string;
}

export interface ParsedRoute {
  httpMethod?: string;
  path: string;
  handlerName?: string;
  lineNumber?: number;
}

export interface ParsedFile {
  language: string;
  lineCount: number;
  imports: ParsedImport[];
  symbols: ParsedSymbol[];
  routes: ParsedRoute[];
}

export interface IndexOptions {
  root: string;
  projectId: string;
  connectionString: string;
  enableSemantic?: boolean;
}

export interface IndexResult {
  filesIndexed: number;
  symbolsIndexed: number;
  dependenciesIndexed: number;
  routesIndexed: number;
  semanticChunksIndexed: number;
}
