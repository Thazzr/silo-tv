import { useState } from 'react';
import { setTransportMode } from '../api/transport';
import { ProbeScreen } from '../probe/ProbeScreen';
import type { ProbeReport } from '../probe/runProbe';
import { FlowApp, type FlowAppProps } from './FlowApp';
import { parseLaunch, type Launch } from './launch';

export interface AppRootProps extends Partial<Omit<FlowAppProps, 'launch'>> {
  /** Raw launch parameters; the app reads them from webOS and the query string by default. */
  launch?: Record<string, unknown>;
  probe?: () => Promise<ProbeReport>;
}

/** Decides between the diagnostics screen (`probe`) and the app flow, once per page load. */
export function AppRoot({ launch: params, probe, ...flow }: AppRootProps) {
  const [launch] = useState<Launch>(() => {
    const parsed = parseLaunch(params);
    // Before any request: the first call of the flow must already use the chosen transport.
    if (parsed.transport) setTransportMode(parsed.transport);
    return parsed;
  });
  if (launch.probe) return <ProbeScreen probe={probe} />;
  return <FlowApp launch={launch} {...flow} />;
}
