// URLs
export const URLS = {
  GITHUB_REPO: 'https://github.com/hlvm-dev/hlvm',
  DISCORD: 'https://discord.gg/C6qfeudedY',
  EMAIL: 'mailto:contact@hlvm.dev',
  LINKEDIN: 'https://www.linkedin.com/company/hlvm-dev',
  TWITTER: 'https://x.com/hlvm_dev',
  SLACK: 'https://join.slack.com/t/hlvm/shared_invite/zt-3bzzxnmqs-YMJDRAXw2~44uU82RyHHrA',
  YOUTUBE: 'https://www.youtube.com/@hlvm-dev',
};

export const DEFAULT_DOC_SLUG = 'guide';
export const DOCS_HOME = `/docs/${DEFAULT_DOC_SLUG}`;

// Navigation Links (landing page)
export const NAV_LINKS = [
  { label: 'GitHub', href: URLS.GITHUB_REPO, external: true },
  { label: 'Docs', to: DOCS_HOME, external: false },
];

// Docs navigation tabs (docs mode NavBar)
export const DOCS_NAV_TABS = [
  { id: 'learn', label: 'Learn', to: DOCS_HOME },
  { id: 'features', label: 'Features', to: '/docs/features/binding' },
  { id: 'api', label: 'API', to: '/docs/api/stdlib' },
];

// Footer Links
export const FOOTER_LINKS = [
  { label: 'Discord', href: URLS.DISCORD, external: true },
  { label: 'LinkedIn', href: URLS.LINKEDIN, external: true },
  { label: 'X', href: URLS.TWITTER, external: true },
  { label: 'YouTube', href: URLS.YOUTUBE, external: true },
  { label: 'Slack', href: URLS.SLACK, external: true },
  { label: 'Contact Us', href: URLS.EMAIL, external: false },
];

export const BREAKPOINTS = {
  MOBILE: 768,
};

// Demo Gallery Content
// Each item: { id, title, description, youtubeId, feature, tags?: string[], duration?: string, thumbnail?: string }
export const DEMOS = [
  {
    id: 'overview',
    title: 'HLVM Overview',
    description: 'Quick tour of the HLVM AI Spotlight and core capabilities.',
    youtubeId: 'p1t8oGBWi-c',
    feature: 'Overview',
    tags: ['intro'],
    duration: '1:20',
  },
  {
    id: 'repl-basics',
    title: 'REPL Basics',
    description: 'Interactive REPL usage and built-in helpers.',
    youtubeId: 'p1t8oGBWi-c',
    feature: 'REPL',
    tags: ['repl', 'basics'],
    duration: '1:05',
  },
  {
    id: 'automation',
    title: 'Desktop Automation',
    description: 'Click, type, and capture with stdlib functions.',
    youtubeId: 'p1t8oGBWi-c',
    feature: 'Automation',
    tags: ['mouse', 'keyboard'],
    duration: '0:58',
  },
];
