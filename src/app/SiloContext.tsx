import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createSiloClient, type SiloClient } from '../api/client';
import type { DeviceIdentity } from '../api/deviceIdentity';
import type { Session } from '../api/session';
import { currentTransport } from '../api/transport';

export interface SiloContextValue {
  baseUrl: string;
  client: SiloClient;
  session: Session;
  device: DeviceIdentity;
}

const SiloContext = createContext<SiloContextValue | null>(null);

/** One client per server and session; the session object is shared for the whole app run. */
export function SiloProvider({
  baseUrl,
  session,
  device,
  children,
}: {
  baseUrl: string;
  session: Session;
  device: DeviceIdentity;
  children: ReactNode;
}) {
  const value = useMemo<SiloContextValue>(
    () => ({
      baseUrl,
      session,
      device,
      client: createSiloClient({ baseUrl, transport: currentTransport, session, device }),
    }),
    [baseUrl, session, device],
  );
  return <SiloContext.Provider value={value}>{children}</SiloContext.Provider>;
}

export function useSilo(): SiloContextValue {
  const value = useContext(SiloContext);
  if (!value) throw new Error('useSilo needs a SiloProvider');
  return value;
}
