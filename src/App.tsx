import { ProbeScreen } from './probe/ProbeScreen';
import type { ProbeReport } from './probe/runProbe';

export function App({ probe }: { probe?: () => Promise<ProbeReport> }) {
  return <ProbeScreen probe={probe} />;
}
