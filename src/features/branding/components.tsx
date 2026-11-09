import { useEffect, useState } from 'react';
import { initialOf } from './branding';
import { useBranding } from './queries';

/**
 * Tracks an image that cannot be loaded: the caller then shows its fallback, silently. The
 * failure is remembered per URL, so a new URL gets its own chance.
 */
function useImageFailed(url: string | null): [boolean, () => void] {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return [url === null || failedUrl === url, () => setFailedUrl(url)];
}

/** The server's mark, or a neutral badge with the initial of its name. */
export function ServerMark({ url, name }: { url: string | null; name: string }) {
  const [failed, fail] = useImageFailed(url);
  if (url && !failed) {
    return (
      <img className="server-mark" src={url} alt="" onError={fail} data-testid="server-mark" />
    );
  }
  return (
    <span className="server-mark badge" aria-hidden="true" data-testid="server-badge">
      {initialOf(name)}
    </span>
  );
}

/** The wordmark on the server and sign-in screens; the server name when there is none. */
export function BrandHeader({ withSubtitle = false }: { withSubtitle?: boolean }) {
  const branding = useBranding();
  const [failed, fail] = useImageFailed(branding.wordmarkUrl);
  return (
    <header className="brand-header" data-testid="brand-header">
      {branding.wordmarkUrl && !failed ? (
        <img
          className="wordmark"
          src={branding.wordmarkUrl}
          alt={branding.serverName}
          onError={fail}
          data-testid="wordmark"
        />
      ) : (
        <p className="brand-name" data-testid="brand-name">
          {branding.serverName}
        </p>
      )}
      {withSubtitle && branding.subtitle ? (
        <p className="brand-subtitle" data-testid="brand-subtitle">
          {branding.subtitle}
        </p>
      ) : null}
    </header>
  );
}

/**
 * The sign-in background under a shade that keeps the page text readable: the lightest possible
 * picture (white) under at least 82 % black is darker than #2e2e2e, which gives the #EDEDED text
 * more than 4.5:1.
 */
export function BrandBackdrop() {
  const branding = useBranding();
  const [failed, fail] = useImageFailed(branding.backgroundUrl);
  if (!branding.backgroundUrl || failed) return null;
  return (
    <div className="brand-backdrop" aria-hidden="true" data-testid="brand-backdrop">
      <img src={branding.backgroundUrl} alt="" onError={fail} />
      <div className="brand-backdrop-shade" />
    </div>
  );
}

/**
 * Applies the server's accent colour as `--accent` while mounted. `useBranding` hands over the
 * accent only when it keeps 4.5:1 on black; the accent is for small highlights and is never the
 * only cue for focus.
 */
export function AccentTheme() {
  const { accent } = useBranding();
  useEffect(() => {
    if (!accent) return;
    const root = document.documentElement;
    root.style.setProperty('--accent', accent);
    return () => {
      root.style.removeProperty('--accent');
    };
  }, [accent]);
  return null;
}
