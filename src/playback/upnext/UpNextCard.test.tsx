import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { episodeOf } from '../../test/detailFixtures';
import { renderWithSilo } from '../../test/renderFlow';
import type { EpisodeRef } from '../episodes/neighbours';
import { UpNextCard } from './UpNextCard';

const NEXT: EpisodeRef = {
  contentId: 'e24',
  seasonNumber: 2,
  episodeNumber: 4,
  title: 'Ganz unten',
};

function setup(overrides: Partial<Parameters<typeof UpNextCard>[0]> = {}) {
  const props = {
    next: NEXT,
    entry: null,
    protectStill: false,
    seconds: 7,
    counting: true,
    focused: true,
    choice: 'play' as const,
    raised: false,
    onPlay: vi.fn(),
    onCancel: vi.fn(),
    onFocus: vi.fn(),
    ...overrides,
  };
  renderWithSilo(<UpNextCard {...props} />, { cardPrefs: false });
  return props;
}

describe('UpNextCard', () => {
  it('names the countdown and the next episode in two lines', () => {
    setup();
    expect(screen.getByTestId('player-upnext-in')).toHaveTextContent('Up next in 7s');
    expect(screen.getByTestId('player-upnext-episode')).toHaveTextContent('S2:E4 — Ganz unten');
    expect(screen.getByRole('group', { name: 'Up next' })).toBeInTheDocument();
    expect(document.querySelector('.player-upnext-line')).not.toBeNull();
  });

  it('without a countdown it reads a plain heading and has no line', () => {
    const { container } = renderWithSilo(
      <UpNextCard
        next={NEXT}
        entry={null}
        protectStill={false}
        seconds={10}
        counting={false}
        focused
        choice="play"
        raised={false}
        onPlay={vi.fn()}
        onCancel={vi.fn()}
        onFocus={vi.fn()}
      />,
      { cardPrefs: false },
    );
    expect(screen.getByTestId('player-upnext-in')).toHaveTextContent(/^Up next$/);
    expect(container.querySelector('.player-upnext-line')).toBeNull();
    expect(screen.getByRole('button', { name: 'Play now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('has Play now and Cancel, and a click on each calls its handler', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Play now' }));
    expect(props.onPlay).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('marks and focuses the button of the choice while the controls hold the focus', () => {
    setup({ choice: 'cancel' });
    expect(screen.getByTestId('player-upnext-cancel')).toHaveAttribute('data-focused', 'true');
    expect(screen.getByTestId('player-upnext-cancel')).toHaveFocus();
    expect(screen.getByTestId('player-upnext-play')).toHaveAttribute('data-focused', 'false');
  });

  it('marks no button and takes no DOM focus when the focus is elsewhere', () => {
    setup({ focused: false });
    expect(screen.getByTestId('player-upnext-play')).toHaveAttribute('data-focused', 'false');
    expect(screen.getByTestId('player-upnext-play')).not.toHaveFocus();
  });

  it('hovering a button asks for its focus', () => {
    const props = setup();
    fireEvent.mouseEnter(screen.getByTestId('player-upnext-cancel'));
    expect(props.onFocus).not.toHaveBeenCalled();
    fireEvent.mouseMove(screen.getByTestId('player-upnext-cancel'));
    expect(props.onFocus).toHaveBeenCalledWith('cancel');
    vi.mocked(props.onFocus).mockClear();
    fireEvent.mouseEnter(screen.getByTestId('player-upnext-play'));
    expect(props.onFocus).not.toHaveBeenCalled();
    fireEvent.mouseMove(screen.getByTestId('player-upnext-play'));
    expect(props.onFocus).toHaveBeenCalledWith('play');
  });

  it('stands above the controls while they are open', () => {
    setup({ raised: true });
    expect(screen.getByTestId('player-upnext')).toHaveAttribute('data-raised', 'true');
  });

  it('shows the episode’s still, and no still without one', () => {
    setup({ entry: episodeOf(2, 4, { still_url: '/img/still-24.png' }) });
    expect(screen.getByTestId('player-upnext-still').querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('/img/still-24.png'),
    );
  });

  it('shows no still without one', () => {
    setup({ entry: episodeOf(2, 4) });
    expect(screen.queryByTestId('player-upnext-still')).toBeNull();
  });

  it('never requests a protected still', () => {
    setup({
      entry: episodeOf(2, 4, { still_url: '/img/still-24.png' }),
      protectStill: true,
    });
    expect(screen.getByTestId('art-protected')).toBeInTheDocument();
    expect(
      screen.getByTestId('player-upnext-still').querySelector('img[src*="still-24"]'),
    ).toBeNull();
  });

  it('shows no overview, only the two lines', () => {
    setup({ entry: episodeOf(2, 4, { overview: 'A secret plot twist.' }) });
    expect(screen.queryByText('A secret plot twist.')).toBeNull();
  });
});
