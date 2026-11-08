import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { DeviceIdentity } from '../../api/deviceIdentity';
import { checkServer, normalizeServerUrl, type ServerCheckResult } from '../../api/server';
import { currentTransport } from '../../api/transport';
import { FocusableInput } from '../../app/nav';
import { Button, Screen } from '../../app/ui';
import { useT, type MessageKey } from '../../i18n';

type FailureReason = 'invalid' | Extract<ServerCheckResult, { ok: false }>['reason'];

class ServerCheckError extends Error {
  constructor(readonly reason: FailureReason) {
    super(reason);
  }
}

const ERROR_KEYS = {
  invalid: 'server.error.invalid',
  unreachable: 'server.error.unreachable',
  not_silo: 'server.error.notSilo',
  unsupported_api: 'server.error.unsupportedApi',
} as const satisfies Record<FailureReason, MessageKey>;

export function ServerScreen({
  initial,
  device,
  onConnected,
}: {
  initial: string;
  device: DeviceIdentity;
  /** Called with the checked server origin. */
  onConnected: (origin: string) => void;
}) {
  const t = useT();
  const [value, setValue] = useState(initial);

  const connect = useMutation({
    mutationFn: async (input: string) => {
      const origin = normalizeServerUrl(input);
      if (!origin) throw new ServerCheckError('invalid');
      const result = await checkServer(origin, currentTransport, device);
      if (!result.ok) throw new ServerCheckError(result.reason);
      return origin;
    },
    onSuccess: (origin) => onConnected(origin),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!connect.isPending) connect.mutate(value);
  };

  const failure =
    connect.error instanceof ServerCheckError ? ERROR_KEYS[connect.error.reason] : null;

  return (
    <Screen title={t('server.title')} testId="server-screen">
      <form onSubmit={submit}>
        <p>{t('server.hint')}</p>
        <FocusableInput
          focusKey="server-input"
          autoFocus
          type="text"
          inputMode="url"
          className="input"
          aria-label={t('server.label')}
          placeholder="https://silo.example.test"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button focusKey="server-connect" type="submit" disabled={connect.isPending}>
          {t('server.connect')}
        </Button>
      </form>
      {connect.isPending ? (
        <p role="status" className="loading">
          <span className="spinner" aria-hidden="true" />
          {t('server.checking')}
        </p>
      ) : null}
      {failure ? (
        <p role="alert" className="error" data-testid="server-error">
          {t(failure)}
        </p>
      ) : null}
    </Screen>
  );
}
