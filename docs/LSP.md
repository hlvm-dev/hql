# HLVM HQL Language Server Protocol (LSP)

The HLVM HQL LSP provides IDE features for HQL code editing.

## Features

| Feature | Description | Status |
|---------|-------------|--------|
| **Diagnostics** | Real-time syntax error reporting | ✅ |
| **Completion** | Autocomplete for keywords, builtins, user symbols | ✅ |
| **Hover** | Function signatures and type info on hover | ✅ |
| **Go to Definition** | Jump to symbol definition | ✅ |
| **Document Sync** | Full and incremental sync | ✅ |

## Quick Start

### Testing

Run the automated LSP unit tests:

```bash
deno task test:unit
```

### Manual Testing

1. Open this project in VS Code
2. Press F5 to launch the Extension Development Host
3. Open any `.hql` file to verify features

## Architecture

```
src/hql/lsp/
├── server.ts              # Main LSP server entry point
├── analysis.ts            # HQL parser integration & symbol extraction
├── documents.ts           # Document manager
├── features/
│   ├── completion.ts      # Autocomplete
│   ├── hover.ts           # Hover information
│   ├── definition.ts      # Go to definition
│   └── diagnostics.ts     # Error reporting
└── utils/
    └── position.ts        # Position conversion utilities
```

## How It Works

### 1. Document Synchronization

When you open/edit an HQL file:
```
Editor → textDocument/didOpen → LSP Server
                                    ↓
                              Parse document
                                    ↓
                              Extract symbols
                                    ↓
                              Send diagnostics
```

### 2. Completion

When you type `(` and press Ctrl+Space:
```
Request: textDocument/completion
Response: [
  { label: "let", kind: Keyword },
  { label: "fn", kind: Keyword },
  { label: "print", kind: Function },
  { label: "myFunction", kind: Function },  // user-defined
  ...
]
```

### 3. Hover

When you hover over a symbol:
```
Request: textDocument/hover (position)
Response: {
  contents: {
    kind: "markdown",
    value: "**Function** `greet`\n\n**Parameters:** name"
  }
}
```

### 4. Go to Definition

When you Ctrl+Click on a symbol:
```
Request: textDocument/definition (position)
Response: {
  uri: "file:///path/to/file.hql",
  range: { start: { line: 5, character: 4 }, end: ... }
}
```

## Symbol Recognition

The LSP recognizes these HQL constructs:

| Construct | Example | Extracted Info |
|-----------|---------|----------------|
| Variable | `(let x 42)` | name, type (inferred) |
| Function | `(fn add [a b] ...)` | name, params |
| Macro | `(macro when [cond body] ...)` | name, params |
| Class | `(class Point ...)` | name, fields, methods |
| Enum | `(enum Color (case Red) ...)` | name, cases |
| Import | `(import [a b] from "...")` | imported symbols |

## Testing

To run the LSP unit tests:

```bash
deno task test:unit
```

This runs the comprehensive test suite located in `tests/unit/lsp/`.

### Integration Tests

The integration tests are now part of the standard test suite.

## Debugging

### Server Logs

The LSP server writes logs to stderr. In VSCode:
1. View → Output
2. Select "HLVM HQL Language Server" from dropdown

### Manual Server Test

Run the server directly:
```bash
hlvm lsp --stdio
```

Then send JSON-RPC messages via stdin.

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| No completion | Analysis not finished | Wait, then retry Ctrl+Space |
| Server crash | Parse error | Check server logs |
| F5 not working | Missing launch.json | Re-run setup script |

## Protocol Details

### Initialize

Request:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "processId": 12345,
    "capabilities": {},
    "rootUri": "file:///project"
  }
}
```

Response capabilities:
```json
{
  "capabilities": {
    "textDocumentSync": 1,
    "completionProvider": { "triggerCharacters": ["(", " "] },
    "hoverProvider": true,
    "definitionProvider": true
  }
}
```

### Message Format

All messages use LSP framing:
```
Content-Length: <length>\r\n
\r\n
<JSON-RPC message>
```

## Configuration

### VSCode Settings

In `.vscode/settings.json`:
```json
{
  "hql.trace.server": "verbose"
}
```

Trace levels:
- `off` - No logging
- `messages` - Request/response only
- `verbose` - Full message content

## Extending

### Adding a New Feature

1. Create handler in `src/hql/lsp/features/`
2. Register in `src/hql/lsp/server.ts`
3. Add tests in `tests/unit/lsp/`

Example - adding "Find References":
```typescript
// src/hql/lsp/features/references.ts
export function getReferences(
  symbols: SymbolTable,
  position: Position
): Location[] {
  // Implementation
}

// src/hql/lsp/server.ts
connection.onReferences((params) => {
  const doc = documents.get(params.textDocument.uri);
  return getReferences(doc.symbols, params.position);
});
```

## Performance

- Document analysis: ~1-5ms for typical files
- Completion: ~1ms (cached symbols)
- Hover: <1ms
- Debounce: 200ms for document changes

## Related Files

- `src/hql/lsp/` - LSP server implementation
- `vscode-hlvm/` - HLVM HQL VSCode extension (package: `hlvm-hql-language`)
- `tests/unit/lsp/` - Unit tests
