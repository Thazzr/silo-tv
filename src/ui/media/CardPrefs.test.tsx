import { render, screen, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithSilo } from '../../test/renderFlow';
import { serveSettings } from '../../test/settingsFixtures';
import { holdAnswers, signedInSession, spoilerValues } from '../../test/spoilerFixtures';
import { useCardBadgePrefs, useSpoilerSettings } from './CardPrefs';
import type { SpoilerSettings } from './spoilers';

// The card preferences are read once above the screens. Real timers: the settings come through
// MSW and React Query.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function Probe({ onSpoilers }: { onSpoilers: (settings: SpoilerSettings) => void }) {
  const badges = useCardBadgePrefs();
  onSpoilers(useSpoilerSettings());
  return <p data-testid="badges">{badges === null ? 'none' : 'some'}</p>;
}

describe('the card preferences', () => {
  it('keeps the spoiler settings object when only the badges change: art and prefetch do not start over', async () => {
    const { gate, release } = holdAnswers();
    serveSettings(server, { overlayGate: gate, values: spoilerValues(true, false) });
    const seen: SpoilerSettings[] = [];
    renderWithSilo(<Probe onSpoilers={(settings) => seen.push(settings)} />, {
      session: signedInSession(),
    });
    // The settings are known, the server's defaults are still on their way: no badges yet.
    await waitFor(() => expect(seen.some((settings) => settings.images)).toBe(true));
    expect(screen.getByTestId('badges')).toHaveTextContent('none');
    const before = seen[seen.length - 1];
    await release();
    await waitFor(() => expect(screen.getByTestId('badges')).toHaveTextContent('some'));
    expect(seen[seen.length - 1]).toBe(before);
  });

  it('refuses to work without its provider, so a card never reads the settings by itself', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => render(<Probe onSpoilers={() => undefined} />)).toThrow(/CardPrefsProvider/);
    } finally {
      error.mockRestore();
    }
  });
});
