// Records a sampling CPU profile of the app on the TV through the webOS Web Inspector (CDP
// Profiler domain), writes it as a .cpuprofile (loadable in Chrome DevTools) and prints a summary.
// Usage: npm run tv:profile -- [--seconds <n>] [--interval <us>] [--out <file>] [--device <name>]
//        [--wait-for <expr>] [--timeout <s>]
// Operate the TV during the countdown (scroll the screen you want to measure). Deploy a build with
// readable function names first: PERF_BUILD=1 npm run tv:deploy.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatCpuProfileSummary,
  killTree,
  parseProfileArgs,
  sleep,
  startInspector,
  summarizeCpuProfile,
  waitUntil,
} from './tv-eval-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { id: appId } = JSON.parse(readFileSync(resolve(root, 'public', 'appinfo.json'), 'utf-8'));

let child;
let exitCode = 0;
try {
  const args = parseProfileArgs(process.argv.slice(2), process.env);
  const inspector = startInspector({ root, device: args.device, appId });
  child = inspector.child;
  process.on('SIGINT', () => {
    killTree(child);
    process.exit(130);
  });
  // Profiler.stop returns the whole profile, which takes long on the TV.
  const { cdp, socket } = await inspector.connect({ requestTimeoutMs: 120_000 });
  try {
    if (args.waitFor) await waitUntil(cdp, args.waitFor, args.timeoutSec);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: args.intervalUs });
    await cdp.send('Profiler.start');
    console.log(`Recording ${args.seconds} s now (sampling every ${args.intervalUs} us) ...`);
    for (let left = args.seconds; left > 0; left -= 5) {
      const step = Math.min(5, left);
      await sleep(step * 1000);
      if (left - step > 0) console.log(`  ${left - step} s left`);
    }
    const { profile } = await cdp.send('Profiler.stop');
    await cdp.send('Profiler.disable').catch(() => {});
    const out = resolve(args.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(profile));
    console.log(`Profile written to ${out}\n`);
    console.log(formatCpuProfileSummary(summarizeCpuProfile(profile)));
  } finally {
    socket.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  if (child) killTree(child);
}
process.exit(exitCode);
