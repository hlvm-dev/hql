import { Link } from 'react-router-dom';
import { ArrowLeftIcon, ArrowRightIcon } from '../Icons';

function DocsPrevNext({ doc }) {
  if (!doc) return null;

  const { prev, next } = doc;
  if (!prev && !next) return null;

  return (
    <nav className="docs-prev-next" aria-label="Previous and next pages">
      {prev ? (
        <Link to={`/docs/${prev}`} className="docs-prev-next-link docs-prev" viewTransition>
          <ArrowLeftIcon size={14} />
          <span>Previous</span>
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link to={`/docs/${next}`} className="docs-prev-next-link docs-next" viewTransition>
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
