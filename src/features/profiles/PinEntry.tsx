import { useCallback, useEffect, useRef, useState } from 'react';
import { SiloApiError } from '../../api/problem';
import { Button } from '../../app/ui';
import { useT } from '../../i18n';
import { useVerifyPin, type Profile } from './queries';

// Silo accepts up to 72 bytes; a TV PIN is a handful of digits, so cap it well below that.
const MAX_DIGITS = 12;

const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'delete', '0', 'confirm'] as const;

/** "5 min" or "30 s": the wait Silo reports in Retry-After. */
function waitText(seconds: number): string {
  return seconds < 60 ? `${Math.max(1, seconds)} s` : `${Math.ceil(seconds / 60)} min`;
}

function digitFromKey(e: KeyboardEvent): string | null {
  if (/^[0-9]$/.test(e.key)) return e.key;
  // webOS number keys: 48-57 on the row, 96-105 on a keypad.
  if (e.keyCode >= 48 && e.keyCode <= 57) return String(e.keyCode - 48);
  if (e.keyCode >= 96 && e.keyCode <= 105) return String(e.keyCode - 96);
  return null;
}

/** PIN entry with the remote's number keys and an on-screen digit pad. */
export function PinEntry({
  profile,
  onVerified,
}: {
  profile: Profile;
  onVerified: (profileToken: string | undefined) => void;
}) {
  const t = useT();
  const verify = useVerifyPin();
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const busy = useRef(false);

  const addDigit = useCallback((digit: string) => {
    setMessage(null);
    setPin((current) => (current.length < MAX_DIGITS ? current + digit : current));
  }, []);

  const confirm = () => {
    if (!pin || busy.current) return;
    busy.current = true;
    verify.mutate(
      { id: profile.id, pin },
      {
        onSuccess: (result) => {
          if (result.valid) {
            onVerified(result.profile_token);
            return;
          }
          setPin('');
          setMessage(t('pin.wrong'));
        },
        onError: (error) => {
          setPin('');
          if (error instanceof SiloApiError && error.status === 429) {
            setMessage(
              error.retryAfter === undefined
                ? t('pin.lockedGeneric')
                : t('pin.locked', { time: waitText(error.retryAfter) }),
            );
          } else {
            setMessage(t('pin.error'));
          }
        },
        onSettled: () => {
          busy.current = false;
        },
      },
    );
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const digit = digitFromKey(e);
      if (digit !== null) addDigit(digit);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [addDigit]);

  return (
    <div data-testid="pin-entry">
      <p>{t('pin.prompt', { name: profile.name })}</p>
      <p
        className="pin-dots"
        aria-label={t('pin.entered', { count: pin.length })}
        data-testid="pin-dots"
      >
        {pin ? '•'.repeat(pin.length) : '–'}
      </p>
      {message ? (
        <p role="alert" className="error" data-testid="pin-message">
          {message}
        </p>
      ) : null}
      <div className="pad">
        {PAD.map((key) => {
          if (key === 'delete') {
            return (
              <Button
                key={key}
                focusKey={`pin-${key}`}
                className="pad-key"
                onClick={() => setPin((p) => p.slice(0, -1))}
              >
                {t('pin.delete')}
              </Button>
            );
          }
          if (key === 'confirm') {
            return (
              <Button
                key={key}
                focusKey={`pin-${key}`}
                className="pad-key"
                disabled={verify.isPending}
                onClick={confirm}
              >
                {t('pin.confirm')}
              </Button>
            );
          }
          return (
            <Button
              key={key}
              focusKey={`pin-${key}`}
              className="pad-key"
              autoFocus={key === '1'}
              onClick={() => addDigit(key)}
            >
              {key}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
