import { act, screen, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Session } from '../../api/session';
import { account, BASE_URL } from '../../test/apiFixtures';
import { catalogItem } from '../../test/flowFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { serveSettings } from '../../test/settingsFixtures';
import { Hero } from './Hero';

// The home hero follows the profile's "title art" setting. Real timers: the answer comes through
// MSW and React Query.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const heat = catalogItem({
  content_id: 'heat',
  title: 'Heat',
  year: 1995,
  logo_url: '/img/heat-logo.webp',
});
const LOGO = `${BASE_URL}/img/heat-logo.webp`;
const logoImages = () => document.querySelectorAll(`img[src="${LOGO}"]`);

function signedIn(): Session {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  return session;
}

function holdAnswers() {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const release = () =>
    act(async () => {
      open();
      await Promise.resolve();
    });
  return { gate, release };
}

describe('Hero: title art', () => {
  it('shows the logo when the profile wants title art', async () => {
    serveSettings(server, { values: { 'ui.title_art': true } });
    renderWithSilo(<Hero item={heat} />, { session: signedIn() });
    const logo = await screen.findByTestId('hero-logo');
    expect(logo).toHaveAttribute('src', LOGO);
    expect(screen.queryByTestId('hero-title')).toBeNull();
  });

  it('shows the text title and never requests the logo when the profile turned it off', async () => {
    serveSettings(server, { values: { 'ui.title_art': false } });
    renderWithSilo(<Hero item={heat} />, { session: signedIn() });
    expect(await screen.findByTestId('hero-title')).toHaveTextContent('Heat');
    expect(screen.queryByTestId('hero-logo')).toBeNull();
    expect(logoImages()).toHaveLength(0);
  });

  it('reserves the logo box and requests no image until the answer is known', async () => {
    const { gate, release } = holdAnswers();
    serveSettings(server, { gate, values: { 'ui.title_art': false } });
    renderWithSilo(<Hero item={heat} />, { session: signedIn() });
    // Unknown: a box where the logo goes, no logo image, no title text that would jump away.
    expect(screen.getByTestId('hero-logo-reserve')).toHaveClass('hero-logo');
    expect(logoImages()).toHaveLength(0);
    expect(screen.queryByTestId('hero-title')).toBeNull();
    await release();
    // Known (off): the text, and the logo was never asked for.
    expect(await screen.findByTestId('hero-title')).toHaveTextContent('Heat');
    expect(screen.queryByTestId('hero-logo-reserve')).toBeNull();
    expect(logoImages()).toHaveLength(0);
  });

  it('swaps the reserved box for the logo once the answer is yes', async () => {
    const { gate, release } = holdAnswers();
    serveSettings(server, { gate });
    renderWithSilo(<Hero item={heat} />, { session: signedIn() });
    expect(screen.getByTestId('hero-logo-reserve')).toBeInTheDocument();
    expect(logoImages()).toHaveLength(0);
    await release();
    await waitFor(() => expect(logoImages()).toHaveLength(1));
    expect(screen.queryByTestId('hero-logo-reserve')).toBeNull();
  });

  it('keeps the text title when the item has no logo, known or not', () => {
    serveSettings(server, { gate: new Promise<void>(() => {}) });
    renderWithSilo(<Hero item={catalogItem({ ...heat, logo_url: undefined })} />, {
      session: signedIn(),
    });
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Heat');
    expect(screen.queryByTestId('hero-logo-reserve')).toBeNull();
  });
});
