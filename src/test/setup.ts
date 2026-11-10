import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { destroyNavigation, initNavigation } from '../app/nav';
import { stopTiming } from '../playback/stopTiming';
import { fakeLayout } from './navLayout';

// findBy*/waitFor give up after 1 s by default, which a loaded machine (parallel runs, the gate)
// can exceed for data that arrives through MSW and React Query.
configure({ asyncUtilTimeout: 8000 });

// Some suites run in the node environment (the service tests); they have no DOM to navigate.
const hasDom = typeof window !== 'undefined';

// jsdom has no media pipeline: load() only logs "not implemented", and the player's engine calls it
// when it releases a video.
if (hasDom) HTMLMediaElement.prototype.load = () => undefined;

// The spatial navigation service is a singleton; each test starts it fresh, with a fake layout.
beforeEach(() => {
  if (hasDom) initNavigation(fakeLayout);
  // The playback stop waits 2 s after the unload in the app; tests do not (playbackStop.test.tsx does).
  stopTiming.delayMs = 0;
});

// Vitest globals are off, so Testing Library cannot register its own cleanup.
afterEach(async () => {
  cleanup();
  if (hasDom) destroyNavigation();
  // A stop that the cleanup just scheduled goes out now, not during the next test.
  if (stopTiming.waiting > 0) await new Promise((resolve) => setTimeout(resolve, 5));
});
