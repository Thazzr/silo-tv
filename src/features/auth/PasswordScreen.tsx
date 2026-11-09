import { useState, type FormEvent } from 'react';
import { FocusGroup, FocusableInput, setFocus } from '../../app/nav';
import { Button, Screen } from '../../app/ui';
import { useT, type MessageKey } from '../../i18n';
import { formatWait } from './format';
import { credentialProviders, defaultProvider, useAuthProviders } from './queries';
import { usePasswordLogin, type PasswordLoginFailure } from './usePasswordLogin';

const USERNAME_KEY = 'password-username';
const PASSWORD_KEY = 'password-password';

const FAILURE_KEYS = {
  wrong: 'password.error.wrong',
  provider: 'password.error.provider',
  denied: 'password.error.denied',
  server: 'password.error.server',
} as const satisfies Record<Exclude<PasswordLoginFailure['kind'], 'locked'>, MessageKey>;

/**
 * Sign-in with a username and a password. OK on a field opens the TV's keyboard. The password is
 * only held in this field while the user types: it is cleared after a failed attempt and never
 * stored or logged. When the server has several credential providers (a local account, a
 * directory), a picker chooses between them, starting on the server's default.
 */
export function PasswordScreen({
  onSignedIn,
  onBack,
}: {
  onSignedIn: () => void;
  /** Leave the screen; the code screen underneath starts a fresh code. */
  onBack: () => void;
}) {
  const t = useT();
  const providers = useAuthProviders();
  const choices = credentialProviders(providers.data?.items);
  const hasChoice = choices.length > 1;
  const [chosen, setChosen] = useState<string | null>(null);
  const provider = chosen ?? defaultProvider(choices)?.id;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { login, pending, failure } = usePasswordLogin(onSignedIn);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    // Enter in a field (the keyboard's "Go") moves on to what is still missing.
    if (!username.trim()) {
      void setFocus(USERNAME_KEY);
      return;
    }
    if (!password) {
      void setFocus(PASSWORD_KEY);
      return;
    }
    const ok = await login(username.trim(), password, hasChoice ? provider : undefined);
    if (!ok) {
      // Never leave a refused password in the field; the next attempt starts empty.
      setPassword('');
      void setFocus(PASSWORD_KEY);
    }
  };

  const message =
    failure === null
      ? null
      : failure.kind === 'locked'
        ? failure.retryAfter === undefined
          ? t('password.error.lockedGeneric')
          : t('password.error.locked', { time: formatWait(failure.retryAfter) })
        : t(FAILURE_KEYS[failure.kind]);

  return (
    <Screen title={t('password.title')} onBack={onBack} testId="password-screen">
      <form onSubmit={(e) => void submit(e)}>
        <p>{t('password.hint')}</p>
        <FocusableInput
          focusKey={USERNAME_KEY}
          autoFocus
          type="text"
          className="input"
          aria-label={t('password.username')}
          placeholder={t('password.username')}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <FocusableInput
          focusKey={PASSWORD_KEY}
          type="password"
          className="input"
          aria-label={t('password.password')}
          placeholder={t('password.password')}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {hasChoice ? (
          <FocusGroup
            focusKey="password-providers"
            role="radiogroup"
            aria-label={t('password.provider')}
            data-testid="provider-picker"
          >
            {choices.map((p) => {
              const selected = p.id === provider;
              return (
                <Button
                  key={p.id}
                  focusKey={`password-provider-${p.id}`}
                  role="radio"
                  aria-checked={selected}
                  className={selected ? 'choice selected' : 'choice'}
                  onClick={() => setChosen(p.id)}
                >
                  <span aria-hidden="true">{selected ? '● ' : '○ '}</span>
                  {p.display_name}
                </Button>
              );
            })}
          </FocusGroup>
        ) : null}
        <Button focusKey="password-submit" type="submit" disabled={pending}>
          {t('password.submit')}
        </Button>
      </form>
      {pending ? (
        <p role="status" className="loading">
          <span className="spinner" aria-hidden="true" />
          {t('password.signingIn')}
        </p>
      ) : null}
      {message ? (
        <p role="alert" className="error" data-testid="password-error">
          {message}
        </p>
      ) : null}
    </Screen>
  );
}
