import { describe, expect, it, vi } from 'vitest';
import { catalogItem } from '../../test/flowFixtures';
import { openItem } from './openItem';

function open(type: string) {
  const play = vi.fn();
  const showSeriesNote = vi.fn();
  const item = catalogItem({ type });
  openItem(item, { play, showSeriesNote });
  return { play, showSeriesNote, item };
}

describe('openItem', () => {
  it.each(['movie', 'episode', 'Movie'])('plays a %s', (type) => {
    const { play, showSeriesNote, item } = open(type);
    expect(play).toHaveBeenCalledWith(item);
    expect(showSeriesNote).not.toHaveBeenCalled();
  });

  it.each(['series', 'Series', 'season'])('only shows the note for a %s', (type) => {
    const { play, showSeriesNote } = open(type);
    expect(showSeriesNote).toHaveBeenCalledTimes(1);
    expect(play).not.toHaveBeenCalled();
  });
});
