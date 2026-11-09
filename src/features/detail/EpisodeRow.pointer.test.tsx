import { act, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getCurrentFocusKey } from '../../app/nav';
import { episodeOf } from '../../test/detailFixtures';
import { KEY, pressKey } from '../../test/keys';
import { renderWithSilo } from '../../test/renderFlow';
import { FocusIndexMemory } from '../../ui/media';
import { EPISODE_STEP } from './layout';
import { EpisodeRow, episodeKey } from './EpisodeRow';

const episodes = Array.from({ length: 12 }, (_, i) => episodeOf(1, i + 1));
const track = () => document.querySelector<HTMLElement>('[data-testid="row-track"]')!;
const focusKeyIs = (focusKey: string) => waitFor(() => expect(getCurrentFocusKey()).toBe(focusKey));

describe('EpisodeRow: the pointer', () => {
  it('focuses a hovered, partly visible episode without moving the strip; the next key scrolls', async () => {
    renderWithSilo(
      <EpisodeRow
        episodes={episodes}
        memory={new FocusIndexMemory()}
        memoryId="s1:1"
        initialIndex={0}
        autoFocusId={episodes[0]!.content_id}
        onOpen={() => undefined}
        onFocused={() => undefined}
      />,
    );
    await focusKeyIs(episodeKey('e11'));
    expect(track().style.transform).toBe('translateX(0px)');
    // Four episodes fit; the fifth is mounted and peeks in at the right edge.
    const peeking = document.querySelector(`[data-focus-key="${episodeKey('e15')}"]`)!;
    fireEvent.mouseEnter(peeking);
    await focusKeyIs(episodeKey('e15'));
    await act(async () => {});
    expect(track().style.transform).toBe('translateX(0px)');
    // The next key moves on from the hovered card and brings the sixth into view.
    await pressKey(KEY.right);
    await focusKeyIs(episodeKey('e16'));
    expect(track().style.transform).toBe(`translateX(${-2 * EPISODE_STEP}px)`);
  });
});
