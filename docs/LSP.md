# HQL Language Server Protocol (LSP)

The HQL LSP provides IDE features for HQL code editing.

## Features

| Feature | Description | Status |
|---------|-------------|--------|
| **Diagnostics** | Real-time syntax error reporting | ✅ |
| **Completion** | Autocomplete for keywords, builtins, user symbols | ✅ |
| **Hover** | Function signatures and type info on hover | ✅ |
| **Go to Definition** | Jump to symbol definition | ✅ |
| **Document Sync** | Full and incremental sync | ✅ |

## Quick Start

### One Command Setup & Test

```bash
./scripts/setup-and-test-lsp.sh
```

This script:
1. Runs automated LSP protocol tests
2. Runs unit tests (37 tests)
3. Compiles VSCode extension
4. Creates test file
5. Opens VSCode ready for F5

### Manual Testing

```bash
# Run automated tests only
deno run --allow-all scripts/test-lsp.ts

# Run unit tests only
deno test tests/unit/lsp/ --allow-all
```

## Architecture

```
lsp/
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

### Test Levels

| Level | Command | Count | Purpose |
|-------|---------|-------|---------|
| Unit | `deno test tests/unit/lsp/` | 37 | Individual components |
| Integration | `deno run --allow-all scripts/test-lsp.ts` | 9 | Full protocol flow |
| Manual | VSCode F5 | - | Real IDE experience |

### Unit Tests

```bash
deno test tests/unit/lsp/ --allow-all
```

Tests:
- `analysis.test.ts` - Parser integration, symbol extraction
- `features.test.ts` - Completion, hover, definition, diagnostics
- `position.test.ts` - Position conversion
- `protocol.test.ts` - LSP protocol messages

### Integration Test

```bash
deno run --allow-all scripts/test-lsp.ts
```

Tests full LSP conversation:
1. Initialize handshake
2. Document open
3. Completion request/response
4. Hover request/response
5. Go to definition
6. Diagnostics
7. Document change
8. Shutdown

### VSCode Testing

#### Method 1: Development Mode (F5)

1. **Open VSCode with vscode-hql as workspace root:**
   ```bash
   code vscode-hql
   ```

   **Important:** You must open `vscode-hql` folder directly, NOT the parent `hql` folder.

2. **Wait 2-3 seconds** for VSCode to fully load

3. **Launch Extension Development Host:**
   - Press `F5` → Select "Run Extension" if prompted
   - Or: `Cmd+Shift+D` → Select "Run Extension" → Click green play button
   - Or: `Cmd+Shift+P` → "Debug: Select and Start Debugging" → "Run Extension"

4. **In the NEW VSCode window that opens:**
   - Open `test-lsp-demo.hql` or any `.hql` file
   - Test features (see below)

#### Method 2: Install VSIX Directly

If F5 doesn't work, install the packaged extension:

```bash
# Package the extension
cd vscode-hql
npx @vscode/vsce package --allow-missing-repository

# Install it
code --install-extension hql-language-0.1.0.vsix
```

Then open any `.hql` file to test.

#### Test Features

- **Completion:** type `(` then `Ctrl+Space`
- **Hover:** mouse over function names
- **Definition:** `Ctrl+Click` on symbol
- **Diagnostics:** add `(let x` (missing paren)

#### F5 Troubleshooting

| Issue | Solution |
|-------|----------|
| F5 shows debugger list | Select "Run Extension" from list |
| F5 shows nothing | Use `Cmd+Shift+P` → "Debug: Select and Start Debugging" |
| No configuration found | Ensure you opened `vscode-hql` folder (not `hql`) |
| Still not working | Try `Cmd+Shift+P` → "Developer: Reload Window" first |

## Debugging

### Server Logs

The LSP server writes logs to stderr. In VSCode:
1. View → Output
2. Select "HQL Language Server" from dropdown

### Manual Server Test

Run server directly:
```bash
deno run --allow-all lsp/server.ts
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

1. Create handler in `lsp/features/`
2. Register in `lsp/server.ts`
3. Add tests in `tests/unit/lsp/`

Example - adding "Find References":
```typescript
// lsp/features/references.ts
export function getReferences(
  symbols: SymbolTable,
  position: Position
): Location[] {
  // Implementation
}

// lsp/server.ts
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

- `lsp/` - LSP server implementation
- `vscode-hql/` - VSCode extension
- `scripts/test-lsp.ts` - Integration test
- `scripts/setup-and-test-lsp.sh` - Setup automation
- `tests/unit/lsp/` - Unit tests
