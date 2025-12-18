/**
 * HQL Language Server
 *
 * Main entry point for the HQL Language Server Protocol implementation.
 * Provides IDE features like diagnostics, hover, go-to-definition, and completion.
 *
 * Usage:
 *   hql lsp --stdio
 *
 * Or directly:
 *   deno run --allow-all lsp/server.ts
 */

import {
  createConnection,
  ProposedFeatures,
  TextDocumentSyncKind,
  StreamMessageReader,
  StreamMessageWriter,
  Location,
} from "npm:vscode-languageserver@9.0.1/node.js";
import type {
  InitializeParams,
  InitializeResult,
  DidOpenTextDocumentParams,
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  HoverParams,
  CompletionParams,
  DefinitionParams,
  DocumentSymbolParams,
  WorkspaceSymbolParams,
  ReferenceParams,
  SignatureHelpParams,
  RenameParams,
  PrepareRenameParams,
  CodeActionParams,
  SymbolInformation,
} from "npm:vscode-languageserver@9.0.1/node.js";
import { TextDocument } from "npm:vscode-languageserver-textdocument@1.0.11";
import process from "node:process";

import { DocumentManager, uriToFilePath, filePathToUri } from "./documents.ts";
import { getDiagnostics } from "./features/diagnostics.ts";
import { getHover, getHoverFromExport } from "./features/hover.ts";
import { getDefinition } from "./features/definition.ts";
import { getCompletions } from "./features/completion.ts";
import type { ImportedModuleContext, CompletionContext } from "./features/completion.ts";
import { getDocumentSymbols, symbolKindToLSP } from "./features/document-symbols.ts";
import { getSignatureHelp } from "./features/signature-help.ts";
import {
  findReferencesInWorkspace,
  findReferencesInContent,
} from "./features/references.ts";
import { prepareRename, performRename, getWordForRename } from "./features/rename.ts";
import { getCodeActions, getSupportedCodeActionKinds } from "./features/code-actions.ts";
import {
  buildSemanticTokens,
  getSemanticTokensCapability,
} from "./features/semantic-tokens.ts";
import { getWordAtPosition } from "./utils/position.ts";
import { ProjectIndex, ImportResolver, ModuleAnalyzer } from "./workspace/mod.ts";

// Create the connection using stdio transport
// This allows communication via stdin/stdout with editors
const connection = createConnection(
  ProposedFeatures.all,
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout)
);

// Document manager with debouncing
const documentManager = new DocumentManager();

// Workspace-wide symbol index for cross-file navigation
const projectIndex = new ProjectIndex();
const importResolver = new ImportResolver();
const moduleAnalyzer = new ModuleAnalyzer();

// Track workspace roots
let workspaceRoots: string[] = [];

/**
 * Initialize: Tell the client what capabilities we support
 */
connection.onInitialize((params: InitializeParams): InitializeResult => {
  // Extract workspace roots from initialization params
  if (params.workspaceFolders) {
    workspaceRoots = params.workspaceFolders.map((f) => uriToFilePath(f.uri));
  } else if (params.rootUri) {
    workspaceRoots = [uriToFilePath(params.rootUri)];
  } else if (params.rootPath) {
    workspaceRoots = [params.rootPath];
  }

  // Configure import resolver with workspace roots
  importResolver.setRoots(workspaceRoots);

  return {
    capabilities: {
      // Document synchronization - we want full document on each change
      textDocumentSync: TextDocumentSyncKind.Full,

      // Hover: show info when mouse hovers over symbol
      hoverProvider: true,

      // Completion: autocomplete suggestions
      completionProvider: {
        triggerCharacters: ["(", " ", ".", ":"],
        resolveProvider: false, // We don't need additional resolution
      },

      // Signature Help: Show parameter hints on function calls
      signatureHelpProvider: {
        triggerCharacters: ["(", " "],
        retriggerCharacters: [" "],
      },

      // Go to Definition: Ctrl+Click to jump to symbol definition
      definitionProvider: true,

      // Document Symbols: Outline view (Cmd+Shift+O)
      documentSymbolProvider: true,

      // Workspace Symbols: Cmd+T to search symbols across project
      workspaceSymbolProvider: true,

      // Find All References: Shift+F12 to find all usages
      referencesProvider: true,

      // Rename Symbol: F2 to rename across workspace
      renameProvider: {
        prepareProvider: true, // Support prepareRename for validation
      },

      // Code Actions: Quick fixes and refactorings
      codeActionProvider: {
        codeActionKinds: getSupportedCodeActionKinds(),
      },

      // Semantic Tokens: Rich syntax highlighting based on semantic analysis
      semanticTokensProvider: getSemanticTokensCapability(),
    },
  };
});

/**
 * Initialized: Server is ready
 */
connection.onInitialized(() => {
  // Server is ready
});

/**
 * Document opened: Parse and analyze
 */
connection.onDidOpenTextDocument((params: DidOpenTextDocumentParams) => {
  const { textDocument } = params;

  // Create TextDocument instance
  const doc = TextDocument.create(
    textDocument.uri,
    textDocument.languageId,
    textDocument.version,
    textDocument.text
  );

  documentManager.open(doc);
});

/**
 * Document changed: Re-analyze with debouncing
 */
connection.onDidChangeTextDocument((params: DidChangeTextDocumentParams) => {
  const { textDocument, contentChanges } = params;

  // Get existing document
  const existingDoc = documentManager.getDocument(textDocument.uri);
  if (!existingDoc) {
    // Document wasn't tracked, shouldn't happen but handle gracefully
    connection.console.warn(
      `Received change for untracked document: ${textDocument.uri}`
    );
    return;
  }

  // Apply changes to create new document version
  // Since we're using Full sync, contentChanges[0] has the full text
  const newDoc = TextDocument.create(
    textDocument.uri,
    existingDoc.languageId,
    textDocument.version,
    contentChanges[0].text
  );

  documentManager.update(newDoc);
});

/**
 * Document closed: Clean up
 */
connection.onDidCloseTextDocument((params: DidCloseTextDocumentParams) => {
  documentManager.close(params.textDocument.uri);
  // Clear diagnostics for closed document
  connection.sendDiagnostics({ uri: params.textDocument.uri, diagnostics: [] });
});

/**
 * When analysis completes, send diagnostics to client and update workspace index
 */
documentManager.setAnalysisCallback((uri, analysis) => {
  // Send diagnostics
  const diagnostics = getDiagnostics(analysis);
  connection.sendDiagnostics({ uri, diagnostics });

  // Update workspace index
  const filePath = uriToFilePath(uri);
  projectIndex.indexFile(filePath, analysis);
});

/**
 * Hover: Show information about symbol under cursor
 */
connection.onHover((params: HoverParams) => {
  const { textDocument, position } = params;

  const doc = documentManager.getDocument(textDocument.uri);
  const analysis = documentManager.getAnalysis(textDocument.uri);

  if (!doc || !analysis) {
    return null;
  }

  // Find the word at cursor position
  const wordInfo = getWordAtPosition(doc, position);
  if (!wordInfo) {
    return null;
  }

  // Look up symbol in local symbol table first
  const symbol = analysis.symbols.get(wordInfo.word);
  if (symbol) {
    return getHover(symbol);
  }

  // Check if it's from an imported external module
  const importSpecifiers = extractImportSpecifiers(analysis);
  for (const specifier of importSpecifiers) {
    if (!moduleAnalyzer.isExternalModule(specifier)) continue;

    // Use cached info if available (non-blocking)
    const cached = moduleAnalyzer.getCached(specifier);
    if (cached) {
      const exp = cached.exports.find(e => e.name === wordInfo.word);
      if (exp) {
        return getHoverFromExport(exp, specifier);
      }
    }
  }

  return null;
});

/**
 * Extract import specifiers from document analysis
 */
function extractImportSpecifiers(analysis: ReturnType<typeof documentManager.getAnalysis>): string[] {
  if (!analysis?.symbols) return [];

  const specifiers: string[] = [];
  for (const symbol of analysis.symbols.getAllSymbols()) {
    if (symbol.kind === "import" && symbol.sourceModule) {
      specifiers.push(symbol.sourceModule);
    }
  }
  return specifiers;
}

/**
 * Analyze imported modules and return their exports
 */
async function getImportedModuleContexts(
  specifiers: string[]
): Promise<ImportedModuleContext[]> {
  const contexts: ImportedModuleContext[] = [];

  for (const specifier of specifiers) {
    // Only analyze external modules (npm:, jsr:, http:, .js, .ts)
    if (!moduleAnalyzer.isExternalModule(specifier)) continue;

    const moduleInfo = await moduleAnalyzer.analyze(specifier);
    if (moduleInfo.exports.length > 0) {
      contexts.push({
        specifier,
        exports: moduleInfo.exports,
      });
    }
  }

  return contexts;
}

/**
 * Completion: Provide autocomplete suggestions
 */
connection.onCompletion(async (params: CompletionParams) => {
  const { textDocument, position } = params;

  const doc = documentManager.getDocument(textDocument.uri);
  const analysis = documentManager.getAnalysis(textDocument.uri);

  // Detect if we're in a type position (after : in parameter or return type)
  const context: CompletionContext = {
    isTypePosition: isTypePosition(doc, position),
  };

  // Get imports from the document and analyze them
  const importSpecifiers = extractImportSpecifiers(analysis);
  const importedModules = await getImportedModuleContexts(importSpecifiers);

  return getCompletions(analysis?.symbols ?? null, importedModules, context);
});

/**
 * Check if cursor is in a type annotation position.
 *
 * Type positions in HQL:
 * - Parameter type: [param:Type]  (after : in param list)
 * - Return type: ] :Type  (after ] and :)
 *
 * Examples:
 *   (fn add [a:| b:number] ...)  <- cursor at | is in type position
 *   (fn greet [name:string] :| ...)  <- cursor at | is in type position
 */
function isTypePosition(
  doc: TextDocument | null,
  position: { line: number; character: number }
): boolean {
  if (!doc) return false;

  const text = doc.getText();
  const lines = text.split("\n");

  if (position.line >= lines.length) return false;

  const line = lines[position.line];
  const beforeCursor = line.substring(0, position.character);

  // Check for parameter type position: identifier followed by :
  // Pattern: word: (we're right after the colon)
  const paramTypeMatch = beforeCursor.match(/[a-zA-Z_][a-zA-Z0-9_\-?!]*:$/);
  if (paramTypeMatch) {
    return true;
  }

  // Check for return type position: ] followed by optional whitespace and :
  // Pattern: ] : (we're right after the colon)
  const returnTypeMatch = beforeCursor.match(/\]\s*:$/);
  if (returnTypeMatch) {
    return true;
  }

  // Also check if we're continuing to type a type annotation
  // Pattern: word: followed by partial type name
  const continuingTypeMatch = beforeCursor.match(/[a-zA-Z_][a-zA-Z0-9_\-?!]*:[a-zA-Z]*$/);
  if (continuingTypeMatch) {
    return true;
  }

  // Return type continuing: ] : followed by partial type
  const continuingReturnMatch = beforeCursor.match(/\]\s*:[a-zA-Z]*$/);
  if (continuingReturnMatch) {
    return true;
  }

  return false;
}

/**
 * Signature Help: Show parameter hints when typing function calls
 */
connection.onSignatureHelp((params: SignatureHelpParams) => {
  const { textDocument, position } = params;

  const doc = documentManager.getDocument(textDocument.uri);
  const analysis = documentManager.getAnalysis(textDocument.uri);

  if (!doc || !analysis) {
    return null;
  }

  return getSignatureHelp(doc, position, analysis.symbols);
});

/**
 * Go to Definition: Navigate to symbol definition
 * Supports cross-file navigation for imported symbols
 */
connection.onDefinition((params: DefinitionParams) => {
  const { textDocument, position } = params;

  const doc = documentManager.getDocument(textDocument.uri);
  const analysis = documentManager.getAnalysis(textDocument.uri);

  if (!doc || !analysis) {
    return null;
  }

  // Find the word at cursor position
  const wordInfo = getWordAtPosition(doc, position);
  if (!wordInfo) {
    return null;
  }

  // Look up symbol in symbol table
  const symbol = analysis.symbols.get(wordInfo.word);
  if (!symbol) {
    return null;
  }

  // Handle cross-file navigation for imported symbols
  if (symbol.isImported && symbol.sourceModule) {
    const currentFilePath = uriToFilePath(textDocument.uri);

    // Resolve the import path to an absolute file path
    const resolvedPath = importResolver.resolve(
      symbol.sourceModule,
      currentFilePath
    );

    if (resolvedPath) {
      // Look up the exported symbol in the target file's index
      const exportedSymbol = projectIndex.getExportedSymbol(
        symbol.name,
        resolvedPath
      );

      if (exportedSymbol?.location) {
        // Return location in the target file
        return {
          uri: filePathToUri(resolvedPath),
          range: {
            start: {
              line: exportedSymbol.location.line - 1,
              character: exportedSymbol.location.column - 1,
            },
            end: {
              line: exportedSymbol.location.line - 1,
              character:
                exportedSymbol.location.column - 1 + exportedSymbol.name.length,
            },
          },
        };
      }
    }
  }

  // Fall back to local definition
  return getDefinition(symbol);
});

/**
 * Document Symbols: Provide outline of all symbols in document
 */
connection.onDocumentSymbol((params: DocumentSymbolParams) => {
  const { textDocument } = params;

  const analysis = documentManager.getAnalysis(textDocument.uri);
  return getDocumentSymbols(analysis?.symbols ?? null);
});

/**
 * Workspace Symbols: Search for symbols across all indexed files (Cmd+T)
 */
connection.onWorkspaceSymbol(
  (params: WorkspaceSymbolParams): SymbolInformation[] => {
    const { query } = params;

    // Search the project index
    const symbols = projectIndex.searchSymbols(query, 50);

    return symbols.map((indexed) => {
      const loc = indexed.info.location;
      const line = (loc?.line ?? 1) - 1; // Convert to 0-indexed
      const column = (loc?.column ?? 1) - 1;

      return {
        name: indexed.info.name,
        kind: symbolKindToLSP(indexed.info.kind),
        location: Location.create(filePathToUri(indexed.filePath), {
          start: { line, character: column },
          end: { line, character: column + indexed.info.name.length },
        }),
        containerName: indexed.info.parent ?? undefined,
      };
    });
  }
);

/**
 * Find All References: Find all usages of a symbol across workspace (Shift+F12)
 *
 * This implementation searches all HQL files in the workspace, not just open documents.
 */
connection.onReferences(async (params: ReferenceParams): Promise<Location[]> => {
  const { textDocument, position, context } = params;

  const doc = documentManager.getDocument(textDocument.uri);
  const analysis = documentManager.getAnalysis(textDocument.uri);

  if (!doc) {
    return [];
  }

  // Find the word at cursor position
  const wordInfo = getWordAtPosition(doc, position);
  if (!wordInfo) {
    return [];
  }

  const symbolName = wordInfo.word;
  const currentFilePath = uriToFilePath(textDocument.uri);

  // Find definition location (for marking)
  let definitionFile: string | undefined;
  let definitionLine: number | undefined;

  if (analysis) {
    const symbol = analysis.symbols.get(symbolName);
    if (symbol?.location && !symbol.isImported) {
      definitionFile = currentFilePath;
      definitionLine = symbol.location.line;
    }
  }

  // If we have workspace roots, search all HQL files
  if (workspaceRoots.length > 0) {
    const results = await findReferencesInWorkspace(
      symbolName,
      workspaceRoots,
      definitionFile,
      definitionLine,
      context.includeDeclaration
    );
    return results.map((r) => r.location);
  }

  // Fallback: Search only open documents (limited functionality)
  const references: Location[] = [];

  for (const uri of documentManager.getAllUris()) {
    const openDoc = documentManager.getDocument(uri);
    if (!openDoc) continue;

    const filePath = uriToFilePath(uri);
    const fileRefs = findReferencesInContent(
      openDoc.getText(),
      symbolName,
      filePath
    );

    // Filter out declaration if needed
    for (const ref of fileRefs) {
      const isDefinition =
        filePath === definitionFile &&
        ref.range.start.line + 1 === definitionLine;

      if (!context.includeDeclaration && isDefinition) {
        continue;
      }

      references.push(ref);
    }
  }

  return references;
});

/**
 * Prepare Rename: Validate that rename is possible at position
 */
connection.onPrepareRename((params: PrepareRenameParams) => {
  const { textDocument, position } = params;

  const doc = documentManager.getDocument(textDocument.uri);
  if (!doc) {
    return null;
  }

  return prepareRename(doc, position);
});

/**
 * Rename Symbol: Rename a symbol across the workspace (F2)
 */
connection.onRenameRequest(async (params: RenameParams) => {
  const { textDocument, position, newName } = params;

  const doc = documentManager.getDocument(textDocument.uri);
  if (!doc) {
    return null;
  }

  // Get the current symbol name
  const oldName = getWordForRename(doc, position);
  if (!oldName) {
    return null;
  }

  // Build map of open documents for fallback
  const openDocs = new Map<string, TextDocument>();
  for (const uri of documentManager.getAllUris()) {
    const d = documentManager.getDocument(uri);
    if (d) {
      openDocs.set(uri, d);
    }
  }

  try {
    return await performRename(oldName, newName, workspaceRoots, openDocs);
  } catch (error) {
    // Return null on error - the client will show a generic message
    connection.console.error(`Rename failed: ${error}`);
    return null;
  }
});

/**
 * Code Actions: Quick fixes and refactorings (lightbulb menu)
 */
connection.onCodeAction((params: CodeActionParams) => {
  const { textDocument } = params;

  const doc = documentManager.getDocument(textDocument.uri);
  if (!doc) {
    return [];
  }

  return getCodeActions(doc, params);
});

/**
 * Semantic Tokens: Rich syntax highlighting based on semantic analysis
 */
connection.languages.semanticTokens.on((params) => {
  const { textDocument } = params;

  const doc = documentManager.getDocument(textDocument.uri);
  const analysis = documentManager.getAnalysis(textDocument.uri);

  if (!doc) {
    return { data: [] };
  }

  const data = buildSemanticTokens(doc, analysis?.symbols ?? null);
  return { data };
});

/**
 * Handle shutdown request
 */
connection.onShutdown(() => {
  connection.console.log("HQL Language Server shutting down");
});

/**
 * Start the server
 */
export function startServer(): void {
  connection.listen();
}

// If run directly (not imported), start the server
if (import.meta.main) {
  startServer();
}
