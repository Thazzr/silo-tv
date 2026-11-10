import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SUBTITLE_APPEARANCE } from '../../features/settings/profileSettings';
import * as appearanceModule from './appearance';
import { SubtitleOverlay } from './SubtitleOverlay';
import { parseWebVtt } from './webvtt';

// Counts how often the cue block renders: it is the only caller of subtitleStyles.
vi.mock('./appearance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appearance')>();
  return { ...actual, subtitleStyles: vi.fn(actual.subtitleStyles) };
});
const styles = vi.mocked(appearanceModule.subtitleStyles);

const cues = parseWebVtt(
  [
    'WEBVTT',
    '',
    '00:00:01.000 --> 00:00:05.000',
    'first <i>line</i>',
    'second line',
    '',
    '00:00:07.000 --> 00:00:08.000',
    'later',
  ].join('\n'),
);

const props = { cues, appearance: DEFAULT_SUBTITLE_APPEARANCE, lifted: false };

beforeEach(() => {
  styles.mockClear();
});

describe('SubtitleOverlay', () => {
  it('draws the active cue line by line, with inline styles from the tags', () => {
    render(<SubtitleOverlay {...props} position={2} />);
    const lines = document.querySelectorAll('.player-subtitle-line');
    expect(lines).toHaveLength(2);
    expect(lines[0]!.textContent).toBe('first line');
    expect(lines[0]!.querySelector('i')?.textContent).toBe('line');
    expect(lines[1]!.textContent).toBe('second line');
  });

  it('draws nothing between cues', () => {
    render(<SubtitleOverlay {...props} position={6} />);
    expect(screen.queryByTestId('player-subtitles')).not.toBeInTheDocument();
  });

  it('never turns cue text into elements', () => {
    const hostile = parseWebVtt(
      'WEBVTT\n\n00:00:01.000 --> 00:00:05.000\n<img src=x onerror=alert(1)>',
    );
    render(<SubtitleOverlay {...props} cues={hostile} position={2} />);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByTestId('player-subtitles').textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('applies the subtitle delay', () => {
    const { rerender } = render(<SubtitleOverlay {...props} position={1.2} offsetMs={500} />);
    expect(screen.queryByTestId('player-subtitles')).not.toBeInTheDocument();
    rerender(<SubtitleOverlay {...props} position={1.6} offsetMs={500} />);
    expect(screen.getByTestId('player-subtitles')).toBeInTheDocument();
  });

  it('renders the block again only when the cue set, the look or the lift changes', () => {
    const { rerender } = render(<SubtitleOverlay {...props} position={1.0} />);
    expect(styles).toHaveBeenCalledTimes(1);
    const block = screen.getByTestId('player-subtitles');
    // Many time updates inside the same cue: nothing renders.
    for (const position of [1.25, 1.5, 2, 3.3, 4.9]) {
      rerender(<SubtitleOverlay {...props} position={position} />);
    }
    expect(styles).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('player-subtitles')).toBe(block);
    // The cue ends: the block goes. The next cue: a new render.
    rerender(<SubtitleOverlay {...props} position={5.5} />);
    expect(screen.queryByTestId('player-subtitles')).not.toBeInTheDocument();
    rerender(<SubtitleOverlay {...props} position={7.1} />);
    expect(styles).toHaveBeenCalledTimes(2);
    // The lift is a change too.
    rerender(<SubtitleOverlay {...props} position={7.2} lifted />);
    expect(styles).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('player-subtitles')).toHaveAttribute('data-lifted', 'true');
  });
});
