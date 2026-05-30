import ts from "typescript";
import { isIndexableSourceFile } from "./ignore.js";
import type { ParsedFile, ParsedImport, ParsedRoute, ParsedSymbol, SymbolKind } from "./types.js";

function scriptKindForPath(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filePath.endsWith(".ts") || filePath.endsWith(".mts")) return ts.ScriptKind.TS;
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function languageForPath(filePath: string): string {
  if (/\.tsx?$/i.test(filePath)) return "typescript";
  if (/\.jsx?$/i.test(filePath)) return "javascript";
  if (/\.mts$/i.test(filePath)) return "typescript";
  if (/\.cts$/i.test(filePath)) return "typescript";
  return "unknown";
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    Boolean(node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
  );
}

function isExported(node: ts.Node): boolean {
  if (hasExportModifier(node)) return true;
  const parent = node.parent;
  if (parent && ts.isExportDeclaration(parent)) return true;
  if (parent && ts.isExportAssignment(parent)) return true;
  return false;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function endLineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
}

function nodeSignature(sourceFile: ts.SourceFile, node: ts.Node): string | undefined {
  const text = node.getText(sourceFile).replace(/\s+/g, " ").trim();
  if (text.length <= 200) return text;
  return `${text.slice(0, 197)}...`;
}

function moduleSpecifierText(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    const spec = node.moduleSpecifier;
    if (spec && ts.isStringLiteral(spec)) return spec.text;
  }
  if (ts.isImportEqualsDeclaration(node)) {
    if (ts.isExternalModuleReference(node.moduleReference)) {
      const expr = node.moduleReference.expression;
      if (ts.isStringLiteral(expr)) return expr.text;
    }
  }
  if (ts.isCallExpression(node)) {
    const expr = node.expression;
    if (ts.isIdentifier(expr) && expr.text === "require" && node.arguments[0]) {
      const arg = node.arguments[0];
      if (ts.isStringLiteral(arg)) return arg.text;
    }
  }
  return undefined;
}

function pushImport(
  imports: ParsedImport[],
  targetModule: string,
  importKind: ParsedImport["importKind"]
): void {
  if (!targetModule) return;
  if (imports.some((i) => i.targetModule === targetModule && i.importKind === importKind)) return;
  imports.push({ targetModule, importKind });
}

function pushSymbol(
  symbols: ParsedSymbol[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  name: string,
  symbolType: SymbolKind
): void {
  if (!name) return;
  symbols.push({
    symbolType,
    name,
    exported: isExported(node),
    lineStart: lineOf(sourceFile, node),
    lineEnd: endLineOf(sourceFile, node),
    signature: nodeSignature(sourceFile, node),
  });
}

function collectFromSourceFile(sourceFile: ts.SourceFile): {
  imports: ParsedImport[];
  symbols: ParsedSymbol[];
} {
  const imports: ParsedImport[] = [];
  const symbols: ParsedSymbol[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const mod = moduleSpecifierText(node);
      if (mod) pushImport(imports, mod, "import");
    } else if (ts.isExportDeclaration(node)) {
      const mod = moduleSpecifierText(node);
      if (mod) pushImport(imports, mod, "export-from");
    } else if (ts.isImportEqualsDeclaration(node)) {
      const mod = moduleSpecifierText(node);
      if (mod) pushImport(imports, mod, "import");
    } else if (ts.isCallExpression(node)) {
      const mod = moduleSpecifierText(node);
      if (mod) pushImport(imports, mod, "require");
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      pushSymbol(symbols, sourceFile, node, node.name.text, "function");
    } else if (ts.isClassDeclaration(node) && node.name) {
      pushSymbol(symbols, sourceFile, node, node.name.text, "class");
    } else if (ts.isInterfaceDeclaration(node)) {
      pushSymbol(symbols, sourceFile, node, node.name.text, "interface");
    } else if (ts.isTypeAliasDeclaration(node)) {
      pushSymbol(symbols, sourceFile, node, node.name.text, "type");
    } else if (ts.isEnumDeclaration(node)) {
      pushSymbol(symbols, sourceFile, node, node.name.text, "enum");
    } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
      pushSymbol(symbols, sourceFile, node, node.name.text, "method");
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          pushSymbol(symbols, sourceFile, node, decl.name.text, "variable");
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { imports, symbols };
}

const FASTIFY_ROUTE_RE =
  /\b(?:app|fastify|server)\.(get|post|put|patch|delete|head|options)(?:<[^>]*>)?\s*\(\s*['"`]([^'"`]+)['"`]/gi;

export function detectFastifyRoutes(source: string): ParsedRoute[] {
  const routes: ParsedRoute[] = [];
  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    FASTIFY_ROUTE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FASTIFY_ROUTE_RE.exec(line)) !== null) {
      routes.push({
        httpMethod: match[1]!.toUpperCase(),
        path: match[2]!,
        lineNumber: i + 1,
      });
    }
  }

  return routes;
}

export function parseSourceFile(content: string, relativePath: string): ParsedFile {
  const language = languageForPath(relativePath);
  const lineCount = content.length === 0 ? 0 : content.split("\n").length;

  if (!isIndexableSourceFile(relativePath)) {
    return { language, lineCount, imports: [], symbols: [], routes: [] };
  }

  const sourceFile = ts.createSourceFile(
    relativePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(relativePath)
  );

  const { imports, symbols } = collectFromSourceFile(sourceFile);
  const routes = detectFastifyRoutes(content);

  return { language, lineCount, imports, symbols, routes };
}

export function parseFile(content: string, relativePath: string): ParsedFile {
  return parseSourceFile(content, relativePath);
}
