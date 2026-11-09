import { fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BASE_URL } from '../../test/apiFixtures';
import { branding } from '../../test/flowFixtures';
import { renderWithSilo } from '../../test/renderFlow';
import { AccentTheme, BrandBackdrop, BrandHeader, ServerMark } from './components';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  document.documentElement.style.removeProperty('--accent');
});
afterAll(() => server.close());

function serve(doc: ReturnType<typeof branding> | 'fail') {
  server.use(
    http.get(`${BASE_URL}/api/v2/theme/branding`, () =>
      doc === 'fail' ? HttpResponse.error() : HttpResponse.json(doc),
    ),
  );
}

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

describe('ServerMark', () => {
  it('shows the image, and an initial badge when it is broken', () => {
    renderWithSilo(<ServerMark url="https://x.test/m.png" name="Barn" />);
    expect(screen.getByTestId('server-mark')).toHaveAttribute('src', 'https://x.test/m.png');
    fireEvent.error(screen.getByTestId('server-mark'));
    expect(screen.getByTestId('server-badge')).toHaveTextContent('B');
  });

  it('shows the badge without a URL', () => {
    renderWithSilo(<ServerMark url={null} name="barn" />);
    expect(screen.getByTestId('server-badge')).toHaveTextContent('B');
    expect(screen.queryByTestId('server-mark')).not.toBeInTheDocument();
  });
});

describe('BrandHeader', () => {
  it('shows the subtitle only when asked to', async () => {
    serve(branding({ login_subtitle: 'Hello there' }));
    const { unmount } = renderWithSilo(<BrandHeader withSubtitle />);
    expect(await screen.findByTestId('brand-subtitle')).toHaveTextContent('Hello there');
    unmount();
    renderWithSilo(<BrandHeader />);
    await waitFor(() => expect(screen.getByTestId('brand-name')).toHaveTextContent('Test Server'));
    expect(screen.queryByTestId('brand-subtitle')).not.toBeInTheDocument();
  });

  it('shows no subtitle element for an empty subtitle', async () => {
    serve(branding({ login_subtitle: '' }));
    renderWithSilo(<BrandHeader withSubtitle />);
    await waitFor(() => expect(screen.getByTestId('brand-name')).toHaveTextContent('Test Server'));
    expect(screen.queryByTestId('brand-subtitle')).not.toBeInTheDocument();
  });
});

describe('BrandBackdrop', () => {
  it('renders nothing without a background', async () => {
    serve(branding());
    renderWithSilo(<BrandBackdrop />);
    await settle(20);
    expect(screen.queryByTestId('brand-backdrop')).not.toBeInTheDocument();
  });
});

describe('AccentTheme', () => {
  const accent = () => document.documentElement.style.getPropertyValue('--accent');

  it('sets --accent for a light colour and removes it when unmounted', async () => {
    serve(branding({ accent_color: '#e5a00d' }));
    const { unmount } = renderWithSilo(<AccentTheme />);
    await waitFor(() => expect(accent()).toBe('#e5a00d'));
    unmount();
    expect(accent()).toBe('');
  });

  it('does not set --accent for a dark colour', async () => {
    serve(branding({ accent_color: '#101a40' }));
    renderWithSilo(<AccentTheme />);
    await settle();
    expect(accent()).toBe('');
  });

  it('does not set --accent when the branding cannot be loaded', async () => {
    serve('fail');
    renderWithSilo(<AccentTheme />);
    await settle();
    expect(accent()).toBe('');
  });
});
