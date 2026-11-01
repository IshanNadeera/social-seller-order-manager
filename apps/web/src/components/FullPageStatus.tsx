/** Centered one-line status (loading, checking a link) with a polite live region. */
export function FullPageStatus({ message }: { message: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 px-4">
      <p role="status" aria-live="polite" className="text-slate-600">
        {message}
      </p>
    </div>
  );
}
