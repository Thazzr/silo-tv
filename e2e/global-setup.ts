import { existsSync } from 'node:fs';
import { distIndexPath } from './paths.ts';

// The tests do not build; the gate runs "build" first. Fail with a clear message instead of a blank page.
export default function globalSetup() {
  if (!existsSync(distIndexPath)) {
    throw new Error(
      `${distIndexPath} does not exist. Run "npm run build" before "npm run test:e2e".`,
    );
  }
}
