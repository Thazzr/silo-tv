// Reads data from the app on the TV through the webOS Web Inspector (Chrome DevTools Protocol).
// Usage: npm run tv:eval -- [expression] [--wait-for <expr>] [--timeout <s>] [--device <name>]
//        [--out <file>]
// Without an expression it prints the TV probe report (window.__SILO_PROBE__) once it is done.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatValue, killTree, parseArgs, startInspector, waitUntil } from './tv-eval-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { id: appId } = JSON.parse(readFileSync(resolve(root, 'public', 'appinfo.json'), 'utf-8'));

let child;
let exitCode = 0;
try {
  const args = parseArgs(process.argv.slice(2), process.env);
  const inspector = startInspector({ root, device: args.device, appId });
  child = inspector.child;
  process.on('SIGINT', () => {
    killTree(child);
    process.exit(130);
  });
  const { cdp, socket } = await inspector.connect();
  try {
    await waitUntil(cdp, args.waitFor, args.timeoutSec);
    const text = formatValue(await cdp.evaluate(args.expression));
    console.log(text);
    if (args.out) writeFileSync(resolve(args.out), text + '\n');
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
