import { useT, type MessageKey } from '../i18n';
import type { DeviceInfo } from '../platform/device';
import type { DisplayInfo, ProbeRow } from '../platform/mediaProbe';
import type { CorsCheckResult } from './corsProbe';
import type { ProbeReport } from './runProbe';

type T = ReturnType<typeof useT>;

// Dynamic keys (check ids, outcomes, categories) cannot be checked by the compiler; the i18n
// tests and the E2E run cover them.
const dynamicKey = (key: string) => key as MessageKey;

function yesNo(t: T, value: boolean | null | undefined): string {
  if (value === null || value === undefined) return t('probe.unknown');
  return t(value ? 'probe.yes' : 'probe.no');
}

function field(source: unknown, key: string): unknown {
  if (source === null || typeof source !== 'object') return undefined;
  return (source as Record<string, unknown>)[key];
}

function text(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function Header({ report }: { report: ProbeReport | null }) {
  const t = useT();
  const device = report?.device;
  const model = field(device?.systemInfo, 'modelName') ?? field(device?.deviceInfo, 'modelName');
  return (
    <header>
      <h1>{t('platform.title')}</h1>
      <dl>
        <dt>{t('platform.version')}</dt>
        <dd>{__APP_VERSION__}</dd>
        <dt>{t('probe.platform')}</dt>
        <dd>
          {device ? device.platform : t('probe.unknown')}
          {model ? ` / ${String(model)}` : ''}
        </dd>
        <dt>{t('probe.chrome')}</dt>
        <dd>
          {device?.chromeMajor ?? t('probe.unknown')}
          {device?.platformVersion ? ` (webOS ${device.platformVersion})` : ''}
        </dd>
      </dl>
    </header>
  );
}

export function ServerSection({ report }: { report: ProbeReport | null }) {
  const t = useT();
  return (
    <section>
      <h2>{t('probe.server.title')}</h2>
      {report === null ? null : report.server === null ? (
        <p data-testid="no-server">{t('probe.server.none')}</p>
      ) : (
        <>
          <p>
            {t('probe.server.origin')}: <span className="mono">{report.server.origin}</span>
          </p>
          {report.cors ? <CorsTable results={report.cors} /> : null}
          {report.corsVerdict ? (
            <p className="verdict" data-testid="cors-verdict">
              {t(dynamicKey(`probe.cors.verdict.${report.corsVerdict}`))}
            </p>
          ) : null}
        </>
      )}
      {report && report.errors.length > 0 ? (
        <>
          <h3>{t('probe.errors')}</h3>
          <ul className="mono" data-testid="probe-errors">
            {report.errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function CorsTable({ results }: { results: CorsCheckResult[] }) {
  const t = useT();
  return (
    <table className="grid" data-testid="cors-table">
      <thead>
        <tr>
          <th>{t('probe.cors.check')}</th>
          <th>{t('probe.cors.outcome')}</th>
          <th>{t('probe.cors.status')}</th>
          <th>{t('probe.cors.time')}</th>
          <th>{t('probe.cors.detail')}</th>
        </tr>
      </thead>
      <tbody>
        {results.map((r) => (
          <tr key={r.id} data-check={r.id} data-outcome={r.outcome}>
            <td>{t(dynamicKey(`probe.cors.id.${r.id}`))}</td>
            <td className={`outcome-${r.outcome}`}>
              {t(dynamicKey(`probe.cors.outcome.${r.outcome}`))}
            </td>
            <td>{r.status ?? ''}</td>
            <td>{r.ms} ms</td>
            <td className="mono">{r.detail ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DisplaySection({ display }: { display: DisplayInfo | null }) {
  const t = useT();
  return (
    <section>
      <h2>{t('probe.display.title')}</h2>
      {display ? (
        <dl>
          <dt>{t('platform.window')}</dt>
          <dd>
            {display.width} × {display.height} @ {display.devicePixelRatio}x
          </dd>
          <dt>{t('probe.display.colorDepth')}</dt>
          <dd>{display.colorDepth}</dd>
          <dt>{t('probe.display.hdr')}</dt>
          <dd>{yesNo(t, display.dynamicRangeHigh)}</dd>
          <dt>{t('probe.display.videoHdr')}</dt>
          <dd>{yesNo(t, display.videoDynamicRangeHigh)}</dd>
        </dl>
      ) : null}
    </section>
  );
}

const CATEGORY_ORDER = ['container', 'h264', 'hevc', 'vp9', 'av1', 'dv', 'audio'] as const;

export function mediaCategory(id: string): (typeof CATEGORY_ORDER)[number] {
  for (const prefix of ['h264', 'hevc', 'vp9', 'av1', 'dv']) {
    if (id.startsWith(prefix + '-')) return prefix as (typeof CATEGORY_ORDER)[number];
  }
  return ['mp4', 'webm', 'mkv', 'mpegts', 'hls-apple', 'hls-x'].includes(id)
    ? 'container'
    : 'audio';
}

export function MediaSection({ media }: { media: ProbeRow[] | null }) {
  const t = useT();
  return (
    <section>
      <h2>{t('probe.media.title')}</h2>
      {media === null ? (
        <p>{t('probe.media.none')}</p>
      ) : (
        <div className="media-grid" data-testid="media-grid">
          {CATEGORY_ORDER.map((category) => {
            const rows = media.filter((row) => mediaCategory(row.id) === category);
            if (rows.length === 0) return null;
            return (
              <div key={category} className="media-group">
                <h3>{t(dynamicKey(`probe.media.cat.${category}`))}</h3>
                <table className="grid compact">
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} data-media={row.id}>
                        <td>{row.label}</td>
                        <td className={row.canPlayType ? 'ok' : 'off'}>{row.canPlayType || '–'}</td>
                        <td className={row.mse ? 'ok' : 'off'}>
                          {row.mse === null ? '?' : row.mse ? t('probe.media.mse') : '–'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function DeviceSection({ device }: { device: DeviceInfo | null }) {
  const t = useT();
  const unknown = t('probe.unknown');
  const info = device?.systemInfo;
  const pick = (key: string) => field(info, key) ?? field(device?.deviceInfo, key);
  return (
    <section>
      <h2>{t('probe.device.title')}</h2>
      {device ? (
        <>
          <dl>
            <dt>{t('probe.device.model')}</dt>
            <dd>{text(pick('modelName'), unknown)}</dd>
            <dt>{t('probe.device.firmware')}</dt>
            <dd>{text(pick('firmwareVersion'), unknown)}</dd>
            <dt>{t('probe.device.sdk')}</dt>
            <dd>{text(pick('sdkVersion'), unknown)}</dd>
            <dt>{t('probe.device.uhd')}</dt>
            <dd>{text(pick('UHD'), unknown)}</dd>
            <dt>{t('platform.userAgent')}</dt>
            <dd className="mono">{device.userAgent}</dd>
          </dl>
          {device.configs ? (
            <>
              <h3>{t('probe.device.configs')}</h3>
              <pre className="raw" data-testid="raw-configs">
                {JSON.stringify(device.configs, null, 2)}
              </pre>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
