import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { makeReport } from '../test/probeFixture';
import { ProbeScreen } from './ProbeScreen';
import type { ProbeReport } from './runProbe';

afterEach(() => vi.restoreAllMocks());

function renderScreen(probe: () => Promise<ProbeReport>, lang: 'en' | 'de' = 'en') {
  return render(
    <I18nProvider lang={lang}>
      <ProbeScreen probe={probe} />
    </I18nProvider>,
  );
}

const press = (keyCode: number, key = '') => fireEvent.keyDown(window, { key, keyCode });

describe('ProbeScreen wheel', () => {
  it('leaves the wheel to native scrolling', async () => {
    renderScreen(() => Promise.resolve(makeReport()));
    await screen.findByText('https://silo.example.test');
    const wheel = new WheelEvent('wheel', { deltaY: 100, cancelable: true });
    window.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
  });
});

describe('ProbeScreen sections', () => {
  it('renders header, server, display, media, device and keys sections', async () => {
    renderScreen(() => Promise.resolve(makeReport()));
    expect(await screen.findByText('https://silo.example.test')).toBeInTheDocument();
    for (const name of ['Server & CORS', 'Display', 'Media', 'Device', 'Last key presses']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getByText('webos / OLED55C1')).toBeInTheDocument();
    expect(screen.getByText('79 (webOS 6.0.0)')).toBeInTheDocument();
    expect(screen.getAllByText('OLED55C1').length).toBeGreaterThan(0);
    expect(screen.getByText('03.30.21')).toBeInTheDocument();
  });

  it('shows the seven CORS checks with outcome, status and time, and the verdict', async () => {
    renderScreen(() => Promise.resolve(makeReport()));
    const table = await screen.findByTestId('cors-table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toHaveTextContent('Direct, simple request (fetch)reached20012 ms');
    expect(rows[1]).toHaveTextContent('blocked');
    expect(rows[6]).toHaveTextContent('Service: POSTreached4018 ms');
    expect(screen.getByTestId('cors-verdict')).toHaveTextContent(
      'direct requests are blocked, the JS service works as a proxy',
    );
  });

  it('groups the media rows by category with canPlayType and MSE', async () => {
    renderScreen(() => Promise.resolve(makeReport()));
    const grid = await screen.findByTestId('media-grid');
    for (const name of ['Containers', 'H.264', 'HEVC', 'VP9', 'AV1', 'Dolby Vision', 'Audio']) {
      expect(within(grid).getByRole('heading', { level: 3, name })).toBeInTheDocument();
    }
    expect(grid.querySelector('[data-media="h264-high-40"]')).toHaveTextContent(
      'H.264 High 4.0probablyMSE',
    );
    const hevc = grid.querySelector('[data-media="hevc-main-40"]');
    expect(hevc).toHaveTextContent('HEVC Main 4.0');
    expect(hevc).not.toHaveTextContent('MSE');
    expect(grid.querySelector('[data-media="dv-dvh1-05"]')).toBeInTheDocument();
    expect(grid.querySelector('[data-media="truehd"]')).toBeInTheDocument();
  });

  it('shows the raw getConfigs dump as preformatted text', async () => {
    renderScreen(() => Promise.resolve(makeReport()));
    expect(await screen.findByTestId('raw-configs')).toHaveTextContent('lg-probe-raw');
  });

  it('says that no server was given instead of showing a CORS table', async () => {
    renderScreen(() =>
      Promise.resolve(makeReport({ server: null, cors: null, corsVerdict: null })),
    );
    expect(await screen.findByTestId('no-server')).toHaveTextContent(
      'no server given – launch with ?server=… or the launch parameter server',
    );
    expect(screen.queryByTestId('cors-table')).not.toBeInTheDocument();
  });

  it('lists probe errors', async () => {
    renderScreen(() => Promise.resolve(makeReport({ errors: ['device: luna down'] })));
    expect(await screen.findByTestId('probe-errors')).toHaveTextContent('device: luna down');
  });

  it('renders German text for lang de', async () => {
    renderScreen(() => Promise.resolve(makeReport()), 'de');
    expect(await screen.findByRole('heading', { level: 2, name: 'Anzeige' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut ausführen' })).toBeInTheDocument();
  });
});

describe('ProbeScreen run again', () => {
  it('focuses the run button on mount and runs once', async () => {
    const probe = vi.fn(() => Promise.resolve(makeReport()));
    renderScreen(probe);
    await waitFor(() => expect(screen.getByRole('button')).toHaveFocus());
    await screen.findByText('https://silo.example.test');
    expect(probe).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Run again' })).toBeInTheDocument();
  });

  it('re-runs on Enter, shows a running state and ignores a second Enter meanwhile', async () => {
    const resolvers: ((report: ProbeReport) => void)[] = [];
    const probe = vi.fn(
      () =>
        new Promise<ProbeReport>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    renderScreen(probe);
    expect(screen.getByRole('button', { name: 'Probe running …' })).toBeInTheDocument();
    // Enter during the first run is ignored.
    press(13, 'Enter');
    expect(probe).toHaveBeenCalledTimes(1);

    await act(async () => resolvers[0]?.(makeReport()));
    expect(screen.getByRole('button', { name: 'Run again' })).toBeInTheDocument();

    press(13, 'Enter');
    expect(probe).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Probe running …' })).toBeInTheDocument();
    press(13, 'Enter');
    press(13, 'Enter');
    expect(probe).toHaveBeenCalledTimes(2);

    await act(async () => resolvers[1]?.(makeReport()));
    press(13, 'Enter');
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it('runs only once when Enter activates the focused button (keydown plus click)', async () => {
    const probe = vi.fn(() => Promise.resolve(makeReport()));
    renderScreen(probe);
    await screen.findByText('https://silo.example.test');
    press(13, 'Enter');
    fireEvent.click(screen.getByRole('button'));
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('keeps the button focused while running', async () => {
    renderScreen(() => Promise.resolve(makeReport()));
    await screen.findByText('https://silo.example.test');
    press(13, 'Enter');
    expect(screen.getByRole('button')).toHaveFocus();
  });
});

describe('ProbeScreen keys', () => {
  it('scrolls the page by 240 px with ArrowDown and ArrowUp and still logs the keys', () => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    renderScreen(() => Promise.resolve(makeReport()));
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, cancelable: true });
    act(() => {
      window.dispatchEvent(down);
    });
    press(38, 'ArrowUp');
    expect(scrollBy.mock.calls).toEqual([[{ top: 240 }], [{ top: -240 }]]);
    expect(down.defaultPrevented).toBe(true);
    const items = within(screen.getByTestId('key-list')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('ArrowUp (code 38) → up');
    expect(items[1]).toHaveTextContent('ArrowDown (code 40) → down');
  });

  it('does not scroll for other keys', () => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    renderScreen(() => Promise.resolve(makeReport()));
    press(37, 'ArrowLeft');
    press(13, 'Enter');
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('prevents the default of Back and lists it', () => {
    renderScreen(() => Promise.resolve(makeReport()));
    const event = new KeyboardEvent('keydown', { key: 'GoBack', keyCode: 461, cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByText('GoBack (code 461) → back')).toBeInTheDocument();
  });
});
