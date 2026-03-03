import DocsPage from '../../../src/views/DocsPage';
import { getAllDocSlugs, getDocPageData } from '../../../src/lib/docs';

export async function generateStaticParams() {
  const slugs = await getAllDocSlugs();
  return slugs.map((slug) => ({ slug: slug.split('/') }));
}

export default async function DocsSlugPage({ params }) {
  const resolvedParams = await params;
  const slug = (resolvedParams?.slug || []).join('/');
  const { manifest, content } = await getDocPageData(slug);

  return <DocsPage manifest={manifest} slug={slug} content={content} />;
}
