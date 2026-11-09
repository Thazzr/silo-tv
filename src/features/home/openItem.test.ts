import { describe, expect, it, vi } from 'vitest';
import type { components } from '../../api/generated/schema';
import { catalogItem } from '../../test/flowFixtures';
import { openItem } from './openItem';

function open(overrides: Partial<components['schemas']['CatalogItem']>) {
  const play = vi.fn();
  const openDetail = vi.fn();
  const item = catalogItem(overrides);
  openItem(item, { play, openDetail });
  return { play, openDetail, item };
}

describe('openItem', () => {
  it.each(['movie', 'Movie', ' movie '])('opens the detail page of a %j', (type) => {
    const { play, openDetail } = open({ type, content_id: 'm1' });
    expect(openDetail).toHaveBeenCalledWith({ itemId: 'm1' });
    expect(play).not.toHaveBeenCalled();
  });

  it.each(['series', 'Series'])('opens the detail page of a %s', (type) => {
    const { play, openDetail } = open({ type, content_id: 's1' });
    expect(openDetail).toHaveBeenCalledWith({ itemId: 's1' });
    expect(play).not.toHaveBeenCalled();
  });

  it.each(['in_progress', 'next_up'])(
    'plays an episode card of Continue Watching or Next Up right away, resuming (%s)',
    (itemSource) => {
      const { play, openDetail, item } = open({
        type: 'episode',
        content_id: 'e1',
        series_id: 's1',
        season_number: 2,
        item_source: itemSource,
      });
      expect(play).toHaveBeenCalledWith(item, { kind: 'resume' });
      expect(openDetail).not.toHaveBeenCalled();
    },
  );

  it('opens the series of any other episode card, on its season and on that episode', () => {
    const { play, openDetail } = open({
      type: 'episode',
      content_id: 'e7',
      series_id: 's1',
      season_number: 2,
      episode_number: 7,
    });
    expect(openDetail).toHaveBeenCalledWith({ itemId: 's1', season: 2, episodeId: 'e7' });
    expect(play).not.toHaveBeenCalled();
  });

  it('plays an episode that does not name its series, there is no page to open', () => {
    const { play, openDetail, item } = open({ type: 'episode', content_id: 'e7' });
    expect(play).toHaveBeenCalledWith(item, { kind: 'ask' });
    expect(openDetail).not.toHaveBeenCalled();
  });

  it('opens the series of a season card on that season', () => {
    const { openDetail } = open({ type: 'season', series_id: 's1', season_number: 3 });
    expect(openDetail).toHaveBeenCalledWith({ itemId: 's1', season: 3 });
  });

  it('plays anything else', () => {
    const { play, openDetail, item } = open({ type: 'audiobook' });
    expect(play).toHaveBeenCalledWith(item, { kind: 'ask' });
    expect(openDetail).not.toHaveBeenCalled();
  });
});
