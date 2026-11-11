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
    // One render for the new prop, one for the measured lift that follows it.
    expect(styles).toHaveBeenCalledTimes(4);
    expect(screen.getByTestId('player-subtitles')).toHaveAttribute('data-lifted', 'true');
  });

  describe('lift above the overlay', () => {
    // jsdom has no layout: a 1080 px player whose overlay body is 300 px tall on a 54 px padding
    // (top edge at y = 726) and whose subtitles rest 76 px up (7 %).
    function renderInPlayer(position: 'bottom' | 'lower-third' | 'top', lifted: boolean) {
      const player = document.createElement('div');
      Object.defineProperty(player, 'clientHeight', { value: 1080 });
      document.body.append(player);
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: Element,
      ) {
        const top = this.classList.contains('player-osd-body') ? 726 : 0;
        return { top, bottom: 1080, height: 1080 } as DOMRect;
      });
      const restBottom = position === 'lower-third' ? 130 : 76;
      vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockReturnValue(1080 - restBottom - 100);
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100);
      const appearance = { ...DEFAULT_SUBTITLE_APPEARANCE, position };
      return render(
        <>
          <SubtitleOverlay {...props} appearance={appearance} position={2} lifted={lifted} />
          <div className="player-osd-body" />
        </>,
        { container: player },
      );
    }

    it('raises bottom subtitles by the overlay body plus a gap, only while it is shown', () => {
      renderInPlayer('bottom', true);
      expect(screen.getByTestId('player-subtitles').style.transform).toBe('translateY(-302px)');
    });

    it('does not raise them while the overlay is hidden', () => {
      renderInPlayer('bottom', false);
      expect(screen.getByTestId('player-subtitles').style.transform).toBe('');
    });

    it('never raises top subtitles', () => {
      renderInPlayer('top', true);
      expect(screen.getByTestId('player-subtitles').style.transform).toBe('');
    });

    it('raises lower-third subtitles only as far as the overlay covers them', () => {
      renderInPlayer('lower-third', true);
      expect(screen.getByTestId('player-subtitles').style.transform).toBe('translateY(-248px)');
    });
  });
});
