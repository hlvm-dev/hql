import { log } from "../../api/log.ts";

/**
 * HLVM HQL LSP Command
 *
 * Starts the HLVM HQL Language Server for IDE integration.
 *
 * Usage:
 *   hlvm lsp           Start LSP server (stdio transport)
 *   hlvm lsp --stdio   Explicitly use stdio transport
 *   hlvm lsp --help    Show help
 */

/**
 * Show help for the LSP command
 */
export function showLspHelp(): void {
  log.raw.log(`
HLVM HQL Language Server

USAGE:
  hlvm lsp [options]

DESCRIPTION:
  Starts the HLVM HQL Language Server Protocol (LSP) server for IDE integration.
  The server communicates over stdio by default.

OPTIONS:
  --stdio             Use stdio transport (default)
  --help, -h          Show this help message

EDITOR SETUP:

  VSCode / Cursor:
    Install the HLVM HQL extension from the marketplace, or configure manually:

    1. Install the HLVM HQL extension
    2. The extension will automatically start the language server

  Neovim (with nvim-lspconfig):
    require('lspconfig').hql.setup{
      cmd = { 'hlvm', 'lsp', '--stdio' },
      filetypes = { 'hql' },
    }

  Emacs (with lsp-mode):
    (lsp-register-client
      (make-lsp-client
        :new-connection (lsp-stdio-connection '("hlvm" "lsp" "--stdio"))
        :major-modes '(hql-mode)
        :server-id 'hql-ls))

  Sublime Text (with LSP package):
    Add to LSP settings:
    {
      "clients": {
        "hql": {
          "enabled": true,
          "command": ["hlvm", "lsp", "--stdio"],
          "selector": "source.hql"
        }
      }
    }

  Helix:
    Add to languages.toml:
    [[language]]
    name = "hql"
    scope = "source.hql"
    file-types = ["hql"]
    language-server = { command = "hlvm", args = ["lsp", "--stdio"] }

FEATURES:
  • Diagnostics    - Real-time error highlighting
  • Hover          - Show symbol information on hover
  • Completion     - Autocomplete for keywords, functions, variables
  • Go to Def      - Jump to symbol definitions (Ctrl+Click)

EXAMPLES:
  hlvm lsp                    # Start LSP server with stdio
  hlvm lsp --stdio            # Explicitly use stdio transport
`);
}

/**
 * Execute the LSP command
 */
export async function lspCommand(args: string[]): Promise<void> {
  // Check for help flag
  if (args.includes("--help") || args.includes("-h")) {
    showLspHelp();
    return;
  }

  // Currently only stdio transport is supported
  // Future: could add --socket, --pipe options

  // Dynamically import the LSP server to avoid loading it unless needed
  const { startServer } = await import("../../../hql/lsp/server.ts");

  // Start the server - this blocks and handles LSP protocol
  startServer();
}
