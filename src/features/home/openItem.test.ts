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

  it('opens the own page of any other episode card, by its content id', () => {
    const { play, openDetail } = open({
      type: 'episode',
      content_id: 'e7',
      series_id: 's1',
      season_number: 2,
      episode_number: 7,
    });
    expect(openDetail).toHaveBeenCalledWith({ itemId: 'e7' });
    expect(play).not.toHaveBeenCalled();
  });

  it('opens the page of an episode that does not name its series too', () => {
    const { play, openDetail } = open({ type: 'episode', content_id: 'e8' });
    expect(openDetail).toHaveBeenCalledWith({ itemId: 'e8' });
    expect(play).not.toHaveBeenCalled();
  });

  it('opens the own page of a season card, by its content id', () => {
    const { play, openDetail } = open({
      type: 'season',
      content_id: 'season-s1-3',
      series_id: 's1',
      season_number: 3,
    });
    expect(openDetail).toHaveBeenCalledWith({ itemId: 'season-s1-3' });
    expect(play).not.toHaveBeenCalled();
  });

  it.each(['movie', 'series', 'season'])(
    'opens the page of a %s card even when its source says in progress',
    (type) => {
      const { play, openDetail } = open({ type, content_id: 'x1', item_source: 'in_progress' });
      expect(openDetail).toHaveBeenCalledWith({ itemId: 'x1' });
      expect(play).not.toHaveBeenCalled();
    },
  );

  it('counts a source with stray spaces and capitals as a resume card too', () => {
    const { play, openDetail, item } = open({
      type: 'episode',
      content_id: 'e1',
      item_source: ' In_Progress ',
    });
    expect(play).toHaveBeenCalledWith(item, { kind: 'resume' });
    expect(openDetail).not.toHaveBeenCalled();
  });

  it('plays anything else', () => {
    const { play, openDetail, item } = open({ type: 'audiobook' });
    expect(play).toHaveBeenCalledWith(item, { kind: 'ask' });
    expect(openDetail).not.toHaveBeenCalled();
  });
});
