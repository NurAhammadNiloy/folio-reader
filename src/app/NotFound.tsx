import { Link } from 'react-router-dom';
export function NotFound() {
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <h1 className="mb-2 text-xl font-semibold">Page not found</h1>
      <p className="mb-4 text-muted">This address does not match anything in Folio.</p>
      <Link className="text-accent underline" to="/">
        Go to your library
      </Link>
    </div>
  );
}
