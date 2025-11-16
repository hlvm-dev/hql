import {
  exists,
  exit as platformExit,
  readTextFile as platformReadTextFile,
  writeTextFile as platformWriteTextFile,
} from "../../src/platform/platform.ts";
import { promptUser, writeJSONFile } from "../publish/utils.ts";
import {
  generateDefaultPackageName,
  validatePackageName,
  validateVersion,
} from "./shared.ts";

export interface HqlConfig {
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
    console.log(`  → ${entryPoint} already exists, skipping sample code`);
    return;
  }

  const sampleCode = `;; HQL Module - Sample Code
;; Edit this file to implement your library or application

;; This is a sample HQL module.
;;
;; To get started:
;;   1. Edit this file and implement your functions
;;   2. Test with: hql run ${entryPoint}
;;   3. Publish with: hql publish
;;
;; For more info: https://github.com/boraseoksoon/hql-dev

;; Sample function - replace with your own code
(fn greet [name]
  (+ "Hello from HQL, " name "!"))

;; Sample function
(fn add [a b]
  (+ a b))

;; Try running: hql run ${entryPoint}
;; You should see this output:
(print (greet "World"))
(print "2 + 3 =" (add 2 3))
`;

  await platformWriteTextFile(entryPoint, sampleCode);
  console.log(`  ✓ ${entryPoint} (sample code included)`);
}

/**
 * Create .gitignore file if it doesn't exist
 */
async function createGitIgnore(): Promise<void> {
  const gitignorePath = ".gitignore";

  if (await exists(gitignorePath)) {
    // Check if it already has HQL entries
    const content = await platformReadTextFile(gitignorePath);
    if (content.includes(".hql-cache") && content.includes("dist/")) {
      return; // Already has HQL entries
    }

    // Append HQL entries
    await platformWriteTextFile(
      gitignorePath,
      `\n# HQL\n.hql-cache/\ndist/\n`,
      { append: true },
    );
    console.log(`  ✓ .gitignore (updated with HQL entries)`);
  } else {
    // Create new .gitignore
    const gitignoreContent = `# HQL
.hql-cache/
dist/

# OS
.DS_Store
Thumbs.db

# Node
node_modules/
`;
    await platformWriteTextFile(gitignorePath, gitignoreContent);
    console.log(`  ✓ .gitignore`);
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
    console.log(`  → README.md already exists, skipping`);
    return;
  }

  const readmeContent = `# ${packageName}

HQL module

## Usage

\`\`\`hql
(import [greet add] from "${packageName}")

(console.log (greet "World"))
(console.log (add 2 3))
\`\`\`

## Development

\`\`\`bash
# Run code
hql run ${entryPoint}

# Publish to JSR/NPM
hql publish
\`\`\`

## License

MIT
`;

  await platformWriteTextFile(readmePath, readmeContent);
  console.log(`  ✓ README.md`);
}

/**
 * Initialize HQL project with hql.json and optional files
 */
export async function init(args: string[]): Promise<void> {
  console.log("\n✨ Initializing HQL project...\n");

  const configPath = "./hql.json";
  const hasYesFlag = args.includes("-y") || args.includes("--yes");

  // Check if hql.json already exists
  if (await exists(configPath)) {
    console.log("⚠️  hql.json already exists");
    const overwrite = hasYesFlag ||
      (await promptUser("Overwrite existing hql.json? (y/N)", "n"));

    if (overwrite.toLowerCase() !== "y") {
      console.log("\n❌ Cancelled");
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

    console.log(`Using defaults:`);
    console.log(`  Name: ${name}`);
    console.log(`  Version: ${version}`);
    console.log(`  Entry: ${entryPoint}\n`);
  } else {
    // Interactive mode - prompt with defaults
    name = await promptUser(`Package name`, defaultName);
    version = await promptUser(`Version`, defaultVersion);
    entryPoint = await promptUser(`Entry point`, defaultEntry);
  }

  // Validate package name and version
  validatePackageName(name);
  validateVersion(version);

  // Create hql.json
  const config: HqlConfig = {
    name,
    version,
    exports: `./${entryPoint}`,
  };

  await writeJSONFile(configPath, config);

  console.log(`\n📁 Created:`);
  console.log(`  ✓ hql.json (${name} v${version})`);

  // Create sample files
  await createSampleModHql(entryPoint);
  await createGitIgnore();
  await createReadme(name, entryPoint);

  // Success message
  console.log(`\n✅ Project initialized!`);
  console.log(`\nNext steps:`);
  console.log(`  1. Edit ${entryPoint} to implement your code`);
  console.log(`  2. Run: hql run ${entryPoint}`);
  console.log(`  3. Publish: hql publish`);

  console.log(`\nTry running the sample code:`);
  console.log(`  hql run ${entryPoint}`);
}

/**
 * Show help for init command
 */
export function showInitHelp(): void {
  console.log(`
HQL Init - Initialize a new HQL project

USAGE:
  hql init               Interactive setup (prompts for configuration)
  hql init -y            Quick setup (use all defaults)
  hql init --yes         Same as -y

EXAMPLES:
  hql init               # Interactive: prompts for name, version, entry point
  hql init -y            # Quick: auto-generates configuration

OPTIONS:
  -y, --yes              Use default values without prompting
  -h, --help             Show this help message

What gets created:
  ✓ hql.json             Project configuration
  ✓ mod.hql              Sample code (if doesn't exist)
  ✓ README.md            Minimal template (if doesn't exist)
  ✓ .gitignore           HQL-specific entries
`);
}
