import { useMemo } from 'react';
import { encode } from 'uqr';
import { Button, Screen } from '../../app/ui';
import { useT } from '../../i18n';
import { formatUserCode } from './format';
import { useAuthProviders } from './queries';
import { useDeviceLogin } from './useDeviceLogin';

// Quiet zone in modules; the QR standard asks for four, and phones need it on a dark screen.
const QUIET_ZONE = 4;

/** One path with a horizontal run per stretch of dark modules. */
function qrPath(data: boolean[][]): string {
  let d = '';
  data.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x += 1;
      d += `M${start + QUIET_ZONE} ${y + QUIET_ZONE}h${x - start}v1h-${x - start}z`;
    }
  });
  return d;
}

/** A QR code as inline SVG on a white square, built from the module matrix. */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 0 });
    return { size: qr.size, path: qrPath(qr.data) };
  }, [value]);
  const full = size + QUIET_ZONE * 2;
  return (
    <svg
      className="qr"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${full} ${full}`}
      shapeRendering="crispEdges"
      data-testid="qr"
    >
      <rect width={full} height={full} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

export function SignInScreen({
  onSignedIn,
  onPassword,
  onBack,
}: {
  onSignedIn: () => void;
  /** Opens the password screen; the pending code is withdrawn first. */
  onPassword: () => void;
  /** Leave the screen; the pending code is withdrawn first. */
  onBack: () => void;
}) {
  const t = useT();
  const { state, restart, cancel } = useDeviceLogin(onSignedIn);
  // Only a server that says so offers the password; until it answers, the code is all there is.
  const providers = useAuthProviders();
  const passwordLogin = providers.data?.password_login === true;

  const back = () => {
    cancel();
    onBack();
  };

  const openPassword = () => {
    cancel();
    onPassword();
  };

  return (
    <Screen title={t('signIn.title')} onBack={back} testId="signin-screen">
      {state.phase === 'checking' ? (
        <p role="status" className="loading">
          <span className="spinner" aria-hidden="true" />
          {t('signIn.preparing')}
        </p>
      ) : null}

      {state.phase === 'unavailable' ? (
        <p role="alert" className="error" data-testid="signin-unavailable">
          {t('signIn.unavailable')}
        </p>
      ) : null}

      {state.phase === 'error' ? (
        <div role="alert" data-testid="signin-error">
          <p className="error">{t('signIn.error')}</p>
          <Button focusKey="signin-retry" autoFocus onClick={restart}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}

      {state.phase === 'denied' || state.phase === 'expired' ? (
        <div role="alert" data-testid={`signin-${state.phase}`}>
          <p className="error">
            {t(state.phase === 'denied' ? 'signIn.denied' : 'signIn.expired')}
          </p>
          <Button focusKey="signin-new-code" autoFocus onClick={restart}>
            {t('signIn.newCode')}
          </Button>
        </div>
      ) : null}

      {state.phase === 'waiting' ? (
        <div className="signin">
          <div>
            <p>{t('signIn.instructions')}</p>
            <p className="url" data-testid="verification-url">
              {state.code.verification_uri}
            </p>
            <p>{t('signIn.enterCode')}</p>
            <p className="user-code" data-testid="user-code">
              {formatUserCode(state.code.user_code)}
            </p>
            {state.opened ? (
              <p role="status" className="note" data-testid="signin-opened">
                {t('signIn.opened')}
              </p>
            ) : (
              <p role="status" className="loading">
                <span className="spinner" aria-hidden="true" />
                {t('signIn.waiting')}
              </p>
            )}
          </div>
          <QrCode value={state.code.verification_uri_complete} label={t('signIn.qrLabel')} />
        </div>
      ) : null}

      {passwordLogin ? (
        <Button
          // With no code on screen this is the way forward, so it takes the focus; autoFocus counts
          // once per mount, hence the key.
          key={state.phase === 'unavailable' ? 'only' : 'also'}
          focusKey="signin-password"
          autoFocus={state.phase === 'unavailable'}
          onClick={openPassword}
        >
          {t('signIn.withPassword')}
        </Button>
      ) : null}

      <Button focusKey="signin-change-server" onClick={back}>
        {t('signIn.changeServer')}
      </Button>
    </Screen>
  );
}
