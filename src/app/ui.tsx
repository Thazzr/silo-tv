import { useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useT } from '../i18n';
import { useFocusNavigation } from './focus';

export function Screen({
  title,
  onBack,
  testId,
  children,
}: {
  title: string;
  onBack?: () => void;
  testId?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useFocusNavigation(ref, onBack);
  return (
    <main className="screen" ref={ref} data-testid={testId}>
      <h1>{title}</h1>
      {children}
    </main>
  );
}

export function Button({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { 'data-autofocus'?: boolean }) {
  return (
    <button
      type="button"
      data-focusable
      {...props}
      className={className ? `btn ${className}` : 'btn'}
    />
  );
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
      <Button onClick={onRetry}>{t('common.retry')}</Button>
    </div>
  );
}
