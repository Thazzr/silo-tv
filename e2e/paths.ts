import { fileURLToPath, pathToFileURL } from 'node:url';

export const distIndexPath = fileURLToPath(new URL('../dist/index.html', import.meta.url));
export const distIndexUrl = pathToFileURL(distIndexPath).href;

// The app flow is the default screen; the diagnostics screen needs the probe launch parameter.
export const probeUrl = `${distIndexUrl}?probe`;
