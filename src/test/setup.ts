import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { destroyNavigation, initNavigation } from '../app/nav';
import { fakeLayout } from './navLayout';

// findBy*/waitFor give up after 1 s by default, which a loaded machine (parallel runs, the gate)
// can exceed for data that arrives through MSW and React Query.
configure({ asyncUtilTimeout: 8000 });

// Some suites run in the node environment (the service tests); they have no DOM to navigate.
const hasDom = typeof window !== 'undefined';

// The spatial navigation service is a singleton; each test starts it fresh, with a fake layout.
beforeEach(() => {
  if (hasDom) initNavigation(fakeLayout);
});

// Vitest globals are off, so Testing Library cannot register its own cleanup.
afterEach(() => {
  cleanup();
  if (hasDom) destroyNavigation();
});
