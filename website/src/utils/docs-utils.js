/**
 * Determine active tab from a docs slug.
 */
export function getActiveTab(slug) {
  if (!slug) return 'learn';
  if (slug.startsWith('features/') || slug.startsWith('features')) return 'features';
  if (slug.startsWith('api/') || slug.startsWith('api')) return 'api';
  return 'learn';
}

/**
 * Extract headings from rendered markdown DOM for TOC.
 */
export function extractHeadings(container) {
  if (!container) return [];
  const headings = [];
  const elements = container.querySelectorAll('h2, h3');
  for (const el of elements) {
    headings.push({
      id: el.id,
      text: el.textContent,
      level: parseInt(el.tagName[1], 10),
    });
  }
  return headings;
}
