#!/usr/bin/env node

/**
 * sync-docs.mjs — Syncs HQL documentation into public/content/ as plain markdown
 * with a manifest.json for the in-app docs renderer.
 *
 * Usage:
 *   node scripts/sync-docs.mjs                    # docs/ is sibling to website/
 *   node scripts/sync-docs.mjs --hql-path ../hql  # explicit path
 */

import { readdir, readFile, writeFile, mkdir, cp, rm, stat } from "node:fs/promises";
import { join, basename, extname, resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEBSITE_ROOT = resolve(__dirname, "..");
const CONTENT_DIR = join(WEBSITE_ROOT, "public", "content");

// Files excluded from sync (internal/architecture docs)
const EXCLUDED_FILES = new Set([
  "ARCHITECTURE.md",
  "SSOT-CONTRACT.md",
  "DOCS-PUBLISHING.md",
]);

const EXCLUDED_PREFIXES = [
  "companion-agent-",
  "memory-system-",
  "mcp-conformance-",
];

function isExcluded(filename) {
  if (EXCLUDED_FILES.has(filename)) return true;
  return EXCLUDED_PREFIXES.some((p) => filename.toLowerCase().startsWith(p));
}

// Top-level docs metadata (order in sidebar)
const TOP_LEVEL_DOCS = [
  { file: "GUIDE.md", label: "Guide", slug: "guide" },
  { file: "MANUAL.md", label: "Manual", slug: "manual" },
  { file: "THE-HQL-PROGRAMMING-LANGUAGE.md", label: "The HQL Language", slug: "the-hql-programming-language" },
  { file: "HQL-SYNTAX.md", label: "Syntax", slug: "hql-syntax" },
  { file: "REFERENCE.md", label: "Reference", slug: "reference" },
  { file: "TYPE-SYSTEM.md", label: "Types", slug: "type-system" },
  { file: "ERROR-SYSTEM.md", label: "Errors", slug: "error-system" },
  { file: "BUILD.md", label: "Build", slug: "build" },
  { file: "TESTING.md", label: "Testing", slug: "testing" },
  { file: "PAREDIT.md", label: "Paredit", slug: "paredit" },
  { file: "style-guide.md", label: "Style Guide", slug: "style-guide" },
  { file: "SELF-HOSTED-STDLIB.md", label: "Self-Hosted Stdlib", slug: "self-hosted-stdlib" },
  { file: "MCP.md", label: "MCP", slug: "mcp" },
  { file: "../CONTRIBUTING.md", label: "Contributing", slug: "contributing" },
];

function parseArgs() {
  const args = process.argv.slice(2);
  let hqlPath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--hql-path" && args[i + 1]) {
      hqlPath = resolve(args[i + 1]);
      i++;
    }
  }

  // Default: docs/ is always sibling to website/
  if (!hqlPath) {
    hqlPath = resolve(WEBSITE_ROOT, "..");
  }

  if (!existsSync(join(hqlPath, "docs"))) {
    console.error(
      "Error: Could not find docs/ directory.\n" +
      "  Expected at: " + join(hqlPath, "docs") + "\n" +
      "  Override: node scripts/sync-docs.mjs --hql-path /path/to/hql"
    );
    process.exit(1);
  }

  return { hqlDocsPath: join(hqlPath, "docs") };
}

/**
 * Resolve a relative path against a base directory.
 * e.g. resolveRelative('features/06-function', '../21-effect-system/')
 *      → 'features/21-effect-system'
 */
function resolveRelative(basePath, relativePath) {
  const segments = basePath ? basePath.split("/").filter(Boolean) : [];
  const linkParts = relativePath.split("/").filter(Boolean);

  for (const part of linkParts) {
    if (part === "..") {
      segments.pop();
    } else if (part !== ".") {
      segments.push(part);
    }
  }
  return segments.join("/");
}

/**
 * Clean a resolved doc path into a canonical slug.
 * Lowercases, strips .md, removes README, strips number prefixes.
 */
function cleanDocPath(resolved) {
  let p = resolved;
  p = p.replace(/\.md$/i, "");
  p = p.toLowerCase();
  p = p.replace(/\/readme$/i, "");
  p = p.replace(/\/+$/, "");
  // features/01-binding → features/binding
  p = p.replace(/\/(\d+)-/g, "/");
  // top-level numbered files
  p = p.replace(/^(\d+)-/, "");
  return p;
}

/**
 * Map bare directory slugs to their canonical first-child page.
 * These slugs have no page of their own — they're section roots.
 */
const DIRECTORY_REDIRECTS = {
  api: "api/stdlib",
  features: "features/binding",
};

/**
 * Transform markdown content:
 * - Strip existing frontmatter
 * - Map ```hql code fences to ```clojure
 * - Convert relative links to /docs/slug format (context-aware)
 *
 * @param {string} content - Raw markdown
 * @param {string} sourceBasePath - Source file's directory relative to docs root
 *        e.g. '' for top-level, 'features/06-function' for a feature file, 'api' for API
 */
function transformContent(content, sourceBasePath = "") {
  let result = content;

  // Strip existing frontmatter
  if (result.startsWith("---")) {
    const endIdx = result.indexOf("---", 3);
    if (endIdx !== -1) {
      result = result.slice(endIdx + 3).trimStart();
    }
  }

  // Map ```hql code fences to ```clojure for syntax highlighting
  result = result.replace(/^```hql$/gm, "```clojure");

  // Protect code blocks and inline code from link transformation.
  // Without this, code like `obj["method"](args)` gets falsely rewritten.
  const codeSlots = [];
  result = result.replace(/```[\s\S]*?```|`[^`]+`/g, (m) => {
    codeSlots.push(m);
    return `\x00CODE${codeSlots.length - 1}\x00`;
  });

  // Convert relative markdown links to /docs/slug format.
  // Requires [text](...) syntax to match only real markdown links.
  // Skips: absolute URLs, anchor-only links, mailto:, non-doc file extensions (.hql, .ts, etc.)
  result = result.replace(
    /(\[[^\]]*\])\((?!https?:\/\/|#|mailto:)([^)]+)\)/g,
    (match, linkText, linkTarget) => {
      // Split anchor from path
      const anchorIdx = linkTarget.indexOf("#");
      const rawPath = anchorIdx >= 0 ? linkTarget.slice(0, anchorIdx) : linkTarget;
      const anchor = anchorIdx >= 0 ? linkTarget.slice(anchorIdx) : "";

      // Only transform .md files and directory links (ending in / or no extension)
      const ext = rawPath.match(/\.(\w+)$/)?.[1]?.toLowerCase();
      if (ext && ext !== "md") return match; // leave .hql, .ts, etc. as-is

      // Resolve relative path against source file's directory
      const resolved = rawPath.startsWith("/")
        ? rawPath.slice(1)
        : resolveRelative(sourceBasePath, rawPath);

      let slug = cleanDocPath(resolved);

      // Normalize paths that escape or re-enter docs root:
      // - Absolute /docs/type-system → after slice(1) → "docs/type-system" → strip "docs/"
      // - CONTRIBUTING.md linking ./docs/BUILD.md → resolves to "../docs/build" → strip "../docs/"
      // - Bare ../ remaining after above → strip
      slug = slug.replace(/^docs\//, "");
      slug = slug.replace(/^\.\.\/?docs\//, "");
      slug = slug.replace(/^\.\.\/?/, "");

      // Map bare directory slugs to their first-child page
      if (DIRECTORY_REDIRECTS[slug]) {
        slug = DIRECTORY_REDIRECTS[slug];
      }

      return `${linkText}(/docs/${slug}${anchor})`;
    }
  );

  // Restore protected code blocks and inline code
  result = result.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeSlots[i]);

  return result;
}

/**
 * Extract title from markdown content (first # heading).
 */
function extractTitle(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Extract all headings from markdown for search index.
 */
function extractHeadings(content) {
  const headings = [];
  const regex = /^(#{1,4})\s+(.+)$/gm;
  let m;
  while ((m = regex.exec(content)) !== null) {
    headings.push({
      level: m[1].length,
      text: m[2].trim(),
      id: slugify(m[2].trim()),
    });
  }
  return headings;
}

/**
 * Create URL-safe slug from text.
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

/**
 * Extract first ~200 chars as excerpt for search.
 */
function extractExcerpt(content, maxLen = 200) {
  // Strip headings, code blocks, links markup
  const plain = content
    .replace(/^```[\s\S]*?^```/gm, "")
    .replace(/^#{1,6}\s+.+$/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\n+/g, " ")
    .trim();
  return plain.length > maxLen ? plain.slice(0, maxLen) + "..." : plain;
}

/**
 * Extract label from feature dir name: "01-binding" → "Binding"
 */
function featureDirToLabel(dirName) {
  return dirName
    .replace(/^\d+-/, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Feature dir name → slug: "01-binding" → "binding"
 */
function featureDirToSlug(dirName) {
  return dirName.replace(/^\d+-/, "");
}

async function syncTopLevelDocs(hqlDocsPath) {
  const existingFiles = new Set(await readdir(hqlDocsPath));
  const sidebarItems = [];
  let synced = 0;

  for (const meta of TOP_LEVEL_DOCS) {
    const srcPath = join(hqlDocsPath, meta.file);
    if (!existsSync(srcPath)) continue;

    let content = await readFile(srcPath, "utf-8");
    // Files from outside docs/ (e.g. ../CONTRIBUTING.md) need their actual base path
    const basePath = meta.file.startsWith("..") ? ".." : "";
    content = transformContent(content, basePath);

    const outName = meta.slug + ".md";
    await writeFile(join(CONTENT_DIR, outName), content, "utf-8");

    const title = extractTitle(content) || meta.label;

    sidebarItems.push({
      slug: meta.slug,
      label: meta.label,
      path: outName,
      title,
    });
    synced++;
  }

  // Also sync any extra top-level .md files not in the predefined list
  for (const file of existingFiles) {
    if (extname(file) !== ".md" || isExcluded(file)) continue;
    if (TOP_LEVEL_DOCS.some((d) => d.file === file)) continue;

    let content = await readFile(join(hqlDocsPath, file), "utf-8");
    content = transformContent(content, "");

    const slug = basename(file, ".md").toLowerCase();
    const outName = slug + ".md";
    await writeFile(join(CONTENT_DIR, outName), content, "utf-8");

    const title = extractTitle(content) || slug;
    sidebarItems.push({
      slug,
      label: title,
      path: outName,
      title,
    });
    synced++;
  }

  console.log(`  Synced ${synced} top-level docs`);
  return sidebarItems;
}

async function syncFeatures(hqlDocsPath) {
  const featuresDir = join(hqlDocsPath, "features");
  if (!existsSync(featuresDir)) {
    console.log("  No features/ directory found, skipping");
    return [];
  }

  const outFeaturesDir = join(CONTENT_DIR, "features");
  await mkdir(outFeaturesDir, { recursive: true });

  const featureDirs = (await readdir(featuresDir)).filter((d) =>
    /^\d+-/.test(d)
  );
  featureDirs.sort();

  const sidebarItems = [];
  let synced = 0;

  for (const dir of featureDirs) {
    const srcDir = join(featuresDir, dir);
    const s = await stat(srcDir);
    if (!s.isDirectory()) continue;

    const featureSlug = featureDirToSlug(dir);
    const featureLabel = featureDirToLabel(dir);
    const outDir = join(outFeaturesDir, featureSlug);
    await mkdir(outDir, { recursive: true });

    const files = await readdir(srcDir);
    const children = [];

    for (const file of files) {
      const srcFile = join(srcDir, file);
      const fstat = await stat(srcFile);
      if (!fstat.isFile()) continue;

      if (extname(file) === ".md") {
        let content = await readFile(srcFile, "utf-8");
        content = transformContent(content, `features/${dir}`);

        const outFileName = file.toLowerCase();
        await writeFile(join(outDir, outFileName), content, "utf-8");

        const isReadme = file.toLowerCase() === "readme.md";
        const childSlug = isReadme
          ? `features/${featureSlug}`
          : `features/${featureSlug}/${basename(file, ".md").toLowerCase()}`;
        const childLabel = isReadme ? featureLabel : extractTitle(content) || basename(file, ".md");

        children.push({
          slug: childSlug,
          label: childLabel,
          path: `features/${featureSlug}/${outFileName}`,
          isIndex: isReadme,
        });
      } else {
        await cp(srcFile, join(outDir, file));
      }
      synced++;
    }

    // Sort: README first, then alphabetical
    children.sort((a, b) => {
      if (a.isIndex) return -1;
      if (b.isIndex) return 1;
      return a.label.localeCompare(b.label);
    });

    // Skip feature groups with no markdown children
    if (children.length === 0) continue;

    sidebarItems.push({
      slug: `features/${featureSlug}`,
      label: featureLabel,
      path: children.find((c) => c.isIndex)?.path || children[0]?.path,
      children,
    });
  }

  console.log(`  Synced ${featureDirs.length} feature directories (${synced} files)`);
  return sidebarItems;
}

async function syncApi(hqlDocsPath) {
  const apiDir = join(hqlDocsPath, "api");
  if (!existsSync(apiDir)) {
    console.log("  No api/ directory found, skipping");
    return [];
  }

  const outApiDir = join(CONTENT_DIR, "api");
  await mkdir(outApiDir, { recursive: true });

  const files = await readdir(apiDir);
  const sidebarItems = [];
  let synced = 0;

  // Desired order
  const apiOrder = ["stdlib.md", "builtins.md", "runtime.md", "module-system.md"];

  const orderedFiles = [
    ...apiOrder.filter((f) => files.includes(f)),
    ...files.filter((f) => !apiOrder.includes(f) && extname(f) === ".md"),
  ];

  for (const file of orderedFiles) {
    const srcFile = join(apiDir, file);
    const s = await stat(srcFile);
    if (!s.isFile()) continue;

    if (extname(file) === ".md") {
      let content = await readFile(srcFile, "utf-8");
      content = transformContent(content, "api");
      await writeFile(join(outApiDir, file), content, "utf-8");

      const slug = `api/${basename(file, ".md")}`;
      const title = extractTitle(content) || basename(file, ".md");

      sidebarItems.push({
        slug,
        label: title,
        path: `api/${file}`,
      });
    } else {
      await cp(srcFile, join(outApiDir, file));
    }
    synced++;
  }

  console.log(`  Synced ${synced} API docs`);
  return sidebarItems;
}

/**
 * Build flat list with prev/next pointers from sidebar sections.
 */
function buildFlatList(sidebar) {
  const flat = [];

  function addItems(items) {
    for (const item of items) {
      if (item.children) {
        // Add the feature group's index page
        const indexChild = item.children.find((c) => c.isIndex);
        if (indexChild) {
          flat.push({ slug: indexChild.slug, label: indexChild.label, path: indexChild.path });
        }
        // Add non-index children
        for (const child of item.children) {
          if (!child.isIndex) {
            flat.push({ slug: child.slug, label: child.label, path: child.path });
          }
        }
      } else {
        flat.push({ slug: item.slug, label: item.label, path: item.path });
      }
    }
  }

  addItems(sidebar.learn);
  addItems(sidebar.features);
  addItems(sidebar.api);

  // Add prev/next pointers
  for (let i = 0; i < flat.length; i++) {
    flat[i].prev = i > 0 ? flat[i - 1].slug : null;
    flat[i].next = i < flat.length - 1 ? flat[i + 1].slug : null;
  }

  return flat;
}

/**
 * Build search index from all markdown files.
 */
async function buildSearchIndex(flat) {
  const search = [];

  for (const item of flat) {
    const filePath = join(CONTENT_DIR, item.path);
    if (!existsSync(filePath)) continue;

    const content = await readFile(filePath, "utf-8");
    const headings = extractHeadings(content);
    const excerpt = extractExcerpt(content);
    const title = extractTitle(content) || item.label;

    search.push({
      slug: item.slug,
      title,
      label: item.label,
      headings: headings.map((h) => ({ text: h.text, id: h.id })),
      excerpt,
    });
  }

  return search;
}

async function main() {
  const { hqlDocsPath } = parseArgs();
  console.log(`Syncing docs from: ${hqlDocsPath}`);
  console.log(`Output to: ${CONTENT_DIR}`);

  // Wipe content/ to prevent stale files
  if (existsSync(CONTENT_DIR)) {
    await rm(CONTENT_DIR, { recursive: true });
  }
  await mkdir(CONTENT_DIR, { recursive: true });

  const learnItems = await syncTopLevelDocs(hqlDocsPath);
  const featureItems = await syncFeatures(hqlDocsPath);
  const apiItems = await syncApi(hqlDocsPath);

  const sidebar = {
    learn: learnItems,
    features: featureItems,
    api: apiItems,
  };

  const flat = buildFlatList(sidebar);
  const search = await buildSearchIndex(flat);

  const manifest = { sidebar, flat, search };

  await writeFile(
    join(CONTENT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );
  console.log(`  Generated manifest.json (${flat.length} docs, ${search.length} search entries)`);

  console.log("Done!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
