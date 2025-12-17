import * as path from "path";
import { workspace, ExtensionContext, window } from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient;

export function activate(context: ExtensionContext) {
  // Path to the LSP server
  const serverModule = path.join(
    context.extensionPath,
    "..",
    "lsp",
    "server.ts"
  );

  // Server options - run with Deno
  const serverOptions: ServerOptions = {
    run: {
      command: "deno",
      args: ["run", "--allow-all", serverModule],
      transport: TransportKind.stdio,
    },
    debug: {
      command: "deno",
      args: ["run", "--allow-all", serverModule],
      transport: TransportKind.stdio,
    },
  };

  // Client options
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "hql" }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher("**/*.hql"),
    },
    outputChannel: window.createOutputChannel("HQL Language Server"),
  };

  // Create the language client
  client = new LanguageClient(
    "hqlLanguageServer",
    "HQL Language Server",
    serverOptions,
    clientOptions
  );

  // Start the client (also starts the server)
  client.start();

  console.log("HQL Language Server activated");
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
