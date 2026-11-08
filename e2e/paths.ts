import { fileURLToPath, pathToFileURL } from 'node:url';

export const distIndexPath = fileURLToPath(new URL('../dist/index.html', import.meta.url));
export const distIndexUrl = pathToFileURL(distIndexPath).href;
