// Test seam: counts the runs of the library's spatial search (the part that measures every
// sibling of the focused element), so a test can prove that a key press was decided without it.
// Not imported by the app.
import { SpatialNavigation } from '@noriginmedia/norigin-spatial-navigation';
import { vi } from 'vitest';

export function spySpatialSearch(): { readonly count: number; restore: () => void } {
  const service = SpatialNavigation as unknown as { smartNavigate: () => Promise<void> };
  const spy = vi.spyOn(service, 'smartNavigate');
  return {
    get count() {
      return spy.mock.calls.length;
    },
    restore: () => spy.mockRestore(),
  };
}
