import { getPlatform } from "../../../platform/platform.ts";
import { log } from "../../api/log.ts";

const p = () => getPlatform();
const exists = (path: string) => p().fs.exists(path);
const platformExit = (code: number) => p().process.exit(code);
const platformReadTextFile = (path: string) => p().fs.readTextFile(path);
const platformWriteTextFile = (path: string, content: string) => p().fs.writeTextFile(path, content);
import { promptUser, writeJSONFile } from "../publish/utils.ts";
import {
  generateDefaultPackageName,
  validatePackageName,
  validateVersion,
} from "./shared.ts";

export interface HlvmProjectConfig {
  name: string;
  version: string;
  exports: string;
  description?: string;
  author?: string;
  license?: string;
}

/**
 * Create sample mod.hql file with working example code
 */
async function createSampleModHql(entryPoint: string): Promise<void> {
  if (await exists(entryPoint)) {
    log.raw.log(`  → ${entryPoint} already exists, skipping sample code`);
    return;
  }

  const sampleCode = `;; HLVM Module - Sample Code
;; Edit this file to implement your library or application

;; This is a sample HLVM module (HQL).
;; 
;; To get started:
;;   1. Edit this file and implement your functions
;;   2. Test with: hlvm run ${entryPoint}
;;   3. Publish with: hlvm publish
;; 
;; For more info: https://github.com/hlvm-dev/hlvm

;; Sample function - replace with your own code
(fn greet [name]
  (+ "Hello from HLVM, " name "!"))

;; Sample function
(fn add [a b]
  (+ a b))

;; Try running: hlvm run ${entryPoint}
;; You should see this output:
(print (greet "World"))
(print "2 + 3 =" (add 2 3))
`;

  await platformWriteTextFile(entryPoint, sampleCode);
  log.raw.log(`  ✓ ${entryPoint} (sample code included)`);
}

/**
 * Create .gitignore file if it doesn't exist
 */
async function createGitIgnore(): Promise<void> {
  const gitignorePath = ".gitignore";

  if (await exists(gitignorePath)) {
    // Check if it already has HLVM entries
    const content = await platformReadTextFile(gitignorePath);
    if (content.includes(".hlvm-cache") && content.includes("dist/")) {
      return; // Already has HLVM entries
    }

    // Append HLVM entries
    await platformWriteTextFile(
      gitignorePath,
      `
# HLVM
.hlvm-cache/
dist/
`,
      { append: true },
    );
    log.raw.log(`  ✓ .gitignore (updated with HLVM entries)`);
  } else {
    // Create new .gitignore
    const gitignoreContent = `# HLVM
.hlvm-cache/
dist/

# OS
.DS_Store
Thumbs.db

# Node
node_modules/
`;
    await platformWriteTextFile(gitignorePath, gitignoreContent);
    log.raw.log(`  ✓ .gitignore`);
  }
}

/**
 * Create minimal README.md if it doesn't exist
 */
async function createReadme(
  packageName: string,
  entryPoint: string,
): Promise<void> {
  const readmePath = "README.md";

  if (await exists(readmePath)) {
    log.raw.log(`  → README.md already exists, skipping`);
    return;
  }

  const readmeContent = `# ${packageName}

HLVM module

## Usage

\`\`\`hql
(import [greet add] from "${packageName}")

(console.log (greet "World"))
(console.log (add 2 3))
\`\`\`

## Development

\`\`\`bash
# Run code
hlvm run ${entryPoint}

# Publish to JSR/NPM
hlvm publish
\`\`\`

## License

MIT
`;

  await platformWriteTextFile(readmePath, readmeContent);
  log.raw.log(`  ✓ README.md`);
}

/**
 * Initialize HLVM project with hlvm.json and optional files
 */
export async function init(args: string[]): Promise<void> {
  log.raw.log("\n✨ Initializing HLVM project...\n");

  const configPath = "./hlvm.json";
  const hasYesFlag = args.includes("-y") || args.includes("--yes");

  // Check if hlvm.json already exists
  if (await exists(configPath)) {
    log.raw.log("⚠️  hlvm.json already exists");
    const overwrite = hasYesFlag ||
      (await promptUser("Overwrite existing hlvm.json? (y/N)", "n"));

    if (typeof overwrite === 'string' && overwrite.toLowerCase() !== "y") {
      log.raw.log("\n❌ Cancelled");
      platformExit(0);
    }
  }

  // Generate smart defaults
  const defaultName = generateDefaultPackageName();
  const defaultVersion = "0.0.1";
  const defaultEntry = "mod.hql";

  let name: string;
  let version: string;
  let entryPoint: string;

  if (hasYesFlag) {
    // Non-interactive mode - use all defaults
    name = defaultName;
    version = defaultVersion;
    entryPoint = defaultEntry;

    log.raw.log(`Using defaults:`);
    log.raw.log(`  Name: ${name}`);
    log.raw.log(`  Version: ${version}`);
    log.raw.log(`  Entry: ${entryPoint}\n`);
  } else {
    // Interactive mode - prompt with defaults
    name = await promptUser(`Package name`, defaultName);
    version = await promptUser(`Version`, defaultVersion);
    entryPoint = await promptUser(`Entry point`, defaultEntry);
  }

  // Validate package name and version
  validatePackageName(name);
  validateVersion(version);

  // Create hlvm.json
  const config: HlvmProjectConfig = {
    name,
    version,
    exports: `./${entryPoint}`,
  };

  await writeJSONFile(configPath, config as unknown as Record<string, unknown>);

  log.raw.log(`\n📁 Created:`);
  log.raw.log(`  ✓ hlvm.json (${name} v${version})`);

  // Create sample files
  await createSampleModHql(entryPoint);
  await createGitIgnore();
  await createReadme(name, entryPoint);

  // Success message
  log.raw.log(`\n✅ Project initialized!`);
  log.raw.log(`\nNext steps:`);
  log.raw.log(`  1. Edit ${entryPoint} to implement your code`);
  log.raw.log(`  2. Run: hlvm run ${entryPoint}`);
  log.raw.log(`  3. Publish: hlvm publish`);

  log.raw.log(`\nTry running the sample code:`);
  log.raw.log(`  hlvm run ${entryPoint}`);
}

/**
 * Show help for init command
 */
export function showInitHelp(): void {
  log.raw.log(`

HLVM Init - Initialize a new HLVM project

USAGE:
  hlvm init               Interactive setup (prompts for configuration)
  hlvm init -y            Quick setup (use all defaults)
  hlvm init --yes         Same as -y

EXAMPLES:
  hlvm init               # Interactive: prompts for name, version, entry point
  hlvm init -y            # Quick: auto-generates configuration

OPTIONS:
  -y, --yes              Use default values without prompting
  -h, --help             Show this help message

What gets created:
  ✓ hlvm.json             Project configuration
  ✓ mod.hql              Sample code (if doesn't exist)
  ✓ README.md            Minimal template (if doesn't exist)
  ✓ .gitignore           HLVM-specific entries
`);
}
