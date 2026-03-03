import 'server-only';
import { cache } from 'react';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';

const CONTENT_DIR = join(process.cwd(), 'public', 'content');
const MANIFEST_PATH = join(CONTENT_DIR, 'manifest.json');

function ensureSafeContentPath(relativePath) {
  const normalized = normalize(relativePath).replace(/^\/+/, '');
  if (normalized.startsWith('..')) {
    throw new Error(`Unsafe docs path: ${relativePath}`);
  }
  return join(CONTENT_DIR, normalized);
}

export const getManifest = cache(async () => {
  const raw = await readFile(MANIFEST_PATH, 'utf-8');
  return JSON.parse(raw);
});

export async function getAllDocSlugs() {
  const manifest = await getManifest();
  return manifest.flat.map((doc) => doc.slug);
}

export async function getDocPageData(slug) {
  const manifest = await getManifest();
  const doc = manifest.flat.find((entry) => entry.slug === slug) || null;

  if (!doc) {
    return { manifest, doc: null, content: null };
  }

  const contentPath = ensureSafeContentPath(doc.path);
  const content = await readFile(contentPath, 'utf-8');

  return { manifest, doc, content };
}
