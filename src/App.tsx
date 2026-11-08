import { useEffect, useState } from 'react';
import { useT } from './i18n';
import { mapKey, type RemoteKey } from './platform/keys';

const MAX_ENTRIES = 10;

interface KeyEntry {
  id: number;
  key: string;
  code: number;
  mapped: RemoteKey | null;
}

export function App() {
  const t = useT();
  const [entries, setEntries] = useState<KeyEntry[]>([]);
  const [viewport, setViewport] = useState(() => readViewport());

  useEffect(() => {
    let nextId = 0;
    const onKeyDown = (e: KeyboardEvent) => {
      // Back must show up as an entry without leaving the app or the browser history.
      const mapped = mapKey(e);
      if (mapped === 'back') e.preventDefault();
      const entry: KeyEntry = { id: nextId++, key: e.key, code: e.keyCode, mapped };
      setEntries((prev) => [entry, ...prev].slice(0, MAX_ENTRIES));
    };
    const onResize = () => setViewport(readViewport());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <main className="platform">
      <h1>{t('platform.title')}</h1>
      <dl>
        <dt>{t('platform.version')}</dt>
        <dd>{__APP_VERSION__}</dd>
        <dt>{t('platform.environment')}</dt>
        <dd>{import.meta.env.MODE}</dd>
        <dt>{t('platform.userAgent')}</dt>
        <dd className="mono">{navigator.userAgent}</dd>
        <dt>{t('platform.window')}</dt>
        <dd>
          {viewport.width} × {viewport.height} @ {viewport.dpr}x
        </dd>
      </dl>
      <h2>{t('platform.keys')}</h2>
      {entries.length === 0 ? (
        <p>{t('platform.keysEmpty')}</p>
      ) : (
        <ol className="keys" data-testid="key-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              {t('platform.keyEntry', {
                key: entry.key,
                code: entry.code,
                mapped: entry.mapped ?? t('platform.unmapped'),
              })}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function readViewport() {
  return { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio };
}
