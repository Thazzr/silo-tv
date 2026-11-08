import { useCallback, useEffect, useRef, useState } from 'react';
import { Focusable } from '../app/nav';
import { useT } from '../i18n';
import { getPlatform, type RemoteKey } from '../platform';
import {
  DeviceSection,
  DisplaySection,
  Header,
  MediaSection,
  ServerSection,
} from './ProbeSections';
import { runProbe, type ProbeReport } from './runProbe';

const MAX_ENTRIES = 10;
// The page is taller than the TV screen and the remote has no scroll wheel.
const SCROLL_STEP = 240;

interface KeyEntry {
  id: number;
  key: string;
  code: number;
  mapped: RemoteKey | null;
}

export function ProbeScreen({ probe = runProbe }: { probe?: () => Promise<ProbeReport> }) {
  const t = useT();
  const [report, setReport] = useState<ProbeReport | null>(null);
  const [running, setRunning] = useState(false);
  const [entries, setEntries] = useState<KeyEntry[]>([]);
  const runningRef = useRef(false);
  const nextId = useRef(0);

  // A ref guards re-entry synchronously: Enter on the focused button reaches both the window
  // key handler and the click handler within one event.
  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    probe()
      .then(setReport, () => undefined)
      .finally(() => {
        runningRef.current = false;
        setRunning(false);
      });
  }, [probe]);

  useEffect(() => {
    start();
  }, [start]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Back must show up as an entry without leaving the app or the browser history.
      const mapped = getPlatform().mapKey(e);
      if (mapped === 'back') e.preventDefault();
      if (mapped === 'enter') start();
      if (mapped === 'up' || mapped === 'down') {
        e.preventDefault();
        window.scrollBy({ top: mapped === 'down' ? SCROLL_STEP : -SCROLL_STEP });
      }
      const entry: KeyEntry = { id: nextId.current++, key: e.key, code: e.keyCode, mapped };
      setEntries((prev) => [entry, ...prev].slice(0, MAX_ENTRIES));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [start]);

  return (
    <main className="platform">
      <Header report={report} />
      <Focusable
        focusKey="probe-rerun"
        autoFocus
        className="rerun"
        aria-disabled={running}
        onClick={start}
        data-running={running}
      >
        {running ? t('probe.running') : t('probe.rerun')}
      </Focusable>
      <ServerSection report={report} />
      <DisplaySection display={report?.display ?? null} />
      {report ? <MediaSection media={report.media} /> : null}
      <DeviceSection device={report?.device ?? null} />
      <section>
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
      </section>
    </main>
  );
}
