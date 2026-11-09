import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { Focusable, useBackHandler, type FocusableProps } from './nav';

export function Screen({
  title,
  onBack,
  testId,
  className,
  children,
}: {
  title: string;
  /** Replaces the default Back (pop the stack, or the exit popup on the root screen). */
  onBack?: () => void;
  testId?: string;
  /** Extra class for the screen, e.g. to centre the profile picker. */
  className?: string;
  children: ReactNode;
}) {
  useBackHandler(onBack);
  return (
    <main className={className ? `screen ${className}` : 'screen'} data-testid={testId}>
      <h1>{title}</h1>
      {children}
    </main>
  );
}

export function Button({ className, ...props }: FocusableProps) {
  return <Focusable {...props} className={className ? `btn ${className}` : 'btn'} />;
}

/** A visual cue for loading; the rows mirror the list that replaces them. */
export function ListSkeleton({ label, rows = 6 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} data-testid="loading">
      <p className="loading">
        <span className="spinner" aria-hidden="true" />
        {label}
      </p>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="row skeleton" aria-hidden="true" />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useT();
  return (
    <div role="alert" data-testid="error-state">
      <p className="error">{message}</p>
      <Button focusKey="retry" autoFocus onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  );
}
