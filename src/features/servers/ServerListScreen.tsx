import { useEffect, useMemo, useState } from 'react';
import { createSiloClient } from '../../api/client';
import type { DeviceIdentity } from '../../api/deviceIdentity';
import { Session } from '../../api/session';
import { currentTransport } from '../../api/transport';
import { useSavedServers, type SavedServer, type ServerRegistry } from '../../app/servers';
import { Button, Screen } from '../../app/ui';
import { useT } from '../../i18n';
import { hostOf } from '../branding/branding';
import { ServerMark } from '../branding/components';
import { useBrandingOf } from '../branding/queries';
import { RemoveServerDialog } from './RemoveServerDialog';
import { useRemoveServer } from './useRemoveServer';

/** Plain http sends the sign-in over the network unprotected; the list says so. */
export function isSecureOrigin(origin: string): boolean {
  return origin.startsWith('https:');
}

function ServerRow({
  server,
  index,
  device,
  registry,
  onChoose,
  onRemove,
}: {
  server: SavedServer;
  index: number;
  device: DeviceIdentity;
  registry: ServerRegistry;
  onChoose: (origin: string) => void;
  onRemove: (server: SavedServer) => void;
}) {
  const t = useT();
  const { origin } = server;
  // The branding is public: an anonymous client of its own asks for it, whatever the session is.
  const client = useMemo(
    () =>
      createSiloClient({
        baseUrl: origin,
        transport: currentTransport,
        session: new Session(null),
        device,
      }),
    [origin, device],
  );
  const { branding, loaded } = useBrandingOf(client, origin);

  // The name is refreshed whenever the list is shown; the fallback (the host) never replaces it.
  const { serverName } = branding;
  useEffect(() => {
    if (loaded) registry.rename(origin, serverName);
  }, [loaded, registry, origin, serverName]);

  return (
    <li className="server-row">
      <Button
        focusKey={`server-${origin}`}
        className="row server"
        autoFocus={index === 0}
        onClick={() => onChoose(origin)}
      >
        <ServerMark url={branding.markUrl} name={server.name} />
        <span className="grow server-text">
          <span className="server-name">{server.name}</span>
          <span className="server-host">{hostOf(origin)}</span>
        </span>
        <span className="pill" data-testid="server-security">
          {isSecureOrigin(origin) ? t('servers.secure') : t('servers.http')}
        </span>
      </Button>
      <Button
        focusKey={`server-remove-${origin}`}
        className="compact"
        aria-label={t('servers.removeNamed', { name: server.name })}
        onClick={() => onRemove(server)}
      >
        {t('servers.remove')}
      </Button>
    </li>
  );
}

/**
 * The servers the user added. The current server is first and has the focus; OK on a row opens
 * it, Right from a row reaches its Remove button, and the last row adds a server. Back leaves
 * the list (on the entry page that asks to exit).
 */
export function ServerListScreen({
  registry,
  device,
  onChoose,
  onAdd,
  onRemoved,
}: {
  registry: ServerRegistry;
  device: DeviceIdentity;
  /** OK on a server: with a session it opens the profiles or the app, without one the sign-in. */
  onChoose: (origin: string) => void;
  onAdd: () => void;
  /** The server and its session are gone. */
  onRemoved: (origin: string) => void;
}) {
  const t = useT();
  const servers = useSavedServers(registry);
  const [confirming, setConfirming] = useState<SavedServer | null>(null);
  const [removing, setRemoving] = useState(false);
  const removeServer = useRemoveServer(registry, device);

  const confirm = async () => {
    if (!confirming || removing) return;
    setRemoving(true);
    try {
      await removeServer(confirming.origin);
      setConfirming(null);
      onRemoved(confirming.origin);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Screen
      title={t('servers.title')}
      // Back closes the confirmation first; on the list itself it is the default.
      onBack={confirming ? () => (removing ? undefined : setConfirming(null)) : undefined}
      testId="servers-screen"
    >
      <ul className="list" data-testid="server-list">
        {servers.map((server, index) => (
          <ServerRow
            key={server.origin}
            server={server}
            index={index}
            device={device}
            registry={registry}
            onChoose={onChoose}
            onRemove={setConfirming}
          />
        ))}
        <li>
          <Button focusKey="server-add" className="row" onClick={onAdd}>
            {t('servers.add')}
          </Button>
        </li>
      </ul>
      {confirming ? (
        <RemoveServerDialog
          name={confirming.name}
          removing={removing}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void confirm()}
        />
      ) : null}
    </Screen>
  );
}
