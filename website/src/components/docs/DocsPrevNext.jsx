import Link from 'next/link';
import { ArrowLeftIcon, ArrowRightIcon } from '../Icons';

function DocsPrevNext({ doc }) {
  if (!doc) return null;

  const { prev, next } = doc;
  if (!prev && !next) return null;

  return (
    <nav className="docs-prev-next" aria-label="Previous and next pages">
      {prev ? (
        <Link href={`/docs/${prev}`} className="docs-prev-next-link docs-prev">
          <ArrowLeftIcon size={14} />
          <span>Previous</span>
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link href={`/docs/${next}`} className="docs-prev-next-link docs-next">
          <span>Next</span>
          <ArrowRightIcon size={14} />
        </Link>
      ) : (
        <div />
      )}
    </nav>
  );
}

export default DocsPrevNext;
