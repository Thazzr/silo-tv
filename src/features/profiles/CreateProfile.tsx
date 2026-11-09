import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { SiloApiError } from '../../api/problem';
import { FocusableInput, setFocus } from '../../app/nav';
import { Button } from '../../app/ui';
import { useT, type MessageKey } from '../../i18n';
import { primaryProfile, useCreateProfile, useProfiles, type Profile } from './queries';

export const MIN_NEW_PIN = 4;
export const MAX_NEW_PIN = 8;
export const MAX_NAME = 64;

const NAME_KEY = 'create-name';
const PIN_KEY = 'create-pin';

/** The message for a refused create: a taken name, a full household, or another refusal. */
function failureKey(error: unknown): MessageKey {
  if (!(error instanceof SiloApiError)) return 'profiles.create.error.unknown';
  if (error.status === 409) return 'profiles.create.error.taken';
  if (error.code === 'profile_limit') return 'profiles.create.error.limit';
  if (error.status === 403) return 'profiles.create.error.forbidden';
  if (error.status === 429) return 'profiles.create.error.rateLimited';
  return 'profiles.create.error.failed';
}

/**
 * The new-profile form: name, optional PIN, and a Kids switch. The request acts as the household's
 * primary profile; `primaryToken` is the PIN proof of that profile when it has a PIN.
 */
export function CreateProfile({
  primaryToken,
  onCreated,
  onCancel,
  onTokenRefused,
}: {
  primaryToken: string | undefined;
  onCreated: (profile: Profile) => void;
  onCancel: () => void;
  /** The server refused the primary profile's PIN proof: ask for the PIN again. */
  onTokenRefused: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const profiles = useProfiles();
  const create = useCreateProfile();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [kids, setKids] = useState(false);
  const [message, setMessage] = useState<MessageKey | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (create.isPending) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage('profiles.create.error.nameRequired');
      void setFocus(NAME_KEY);
      return;
    }
    if (pin && (pin.length < MIN_NEW_PIN || pin.length > MAX_NEW_PIN)) {
      setMessage('profiles.create.error.pinLength');
      void setFocus(PIN_KEY);
      return;
    }
    const primary = primaryProfile(profiles.data);
    if (!primary) {
      setMessage('profiles.create.error.forbidden');
      return;
    }
    setMessage(null);
    create.mutate(
      { primaryId: primary.id, primaryToken, name: trimmed, pin: pin || undefined, isChild: kids },
      {
        onSuccess: onCreated,
        onError: (error) => {
          if (
            error instanceof SiloApiError &&
            error.status === 403 &&
            error.code === 'profile_verification_required'
          ) {
            onTokenRefused();
            return;
          }
          // Without an answer the profile may exist: the list is read again.
          if (!(error instanceof SiloApiError)) {
            void queryClient.invalidateQueries({ queryKey: ['profiles'] });
          }
          setMessage(failureKey(error));
        },
      },
    );
  };

  return (
    <form onSubmit={submit} data-testid="create-profile">
      <p>{t('profiles.create.hint')}</p>
      <FocusableInput
        focusKey={NAME_KEY}
        autoFocus
        type="text"
        className="input"
        aria-label={t('profiles.create.name')}
        placeholder={t('profiles.create.name')}
        maxLength={MAX_NAME}
        autoCapitalize="words"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setMessage(null);
        }}
      />
      <FocusableInput
        focusKey={PIN_KEY}
        type="password"
        inputMode="numeric"
        className="input"
        aria-label={t('profiles.create.pin')}
        placeholder={t('profiles.create.pin')}
        maxLength={MAX_NEW_PIN}
        autoComplete="off"
        value={pin}
        onChange={(e) => {
          setPin(e.target.value.replace(/\D/g, ''));
          setMessage(null);
        }}
      />
      <Button
        focusKey="create-kids"
        role="switch"
        aria-checked={kids}
        className={kids ? 'choice selected' : 'choice'}
        onClick={() => setKids((on) => !on)}
      >
        <span aria-hidden="true">{kids ? '● ' : '○ '}</span>
        {t('profiles.create.kids')}
      </Button>
      {kids ? (
        <p className="note" data-testid="kids-hint">
          {t('profiles.create.kidsHint')}
        </p>
      ) : null}
      <div className="form-actions">
        <Button focusKey="create-save" type="submit" disabled={create.isPending}>
          {create.isPending ? t('profiles.create.saving') : t('profiles.create.save')}
        </Button>
        <Button focusKey="create-cancel" className="secondary" onClick={onCancel}>
          {t('profiles.create.cancel')}
        </Button>
      </div>
      {message ? (
        <p role="alert" className="error" data-testid="create-error">
          {t(message)}
        </p>
      ) : null}
    </form>
  );
}
