import { describe, expect, it, vi } from 'vitest';
import type { components } from '../../api/generated/schema';
import { catalogItem } from '../../test/flowFixtures';
import { openItem, openItemPage, playFeatured } from './openItem';

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

describe('openItemPage', () => {
  it('opens the page of an episode of Continue Watching instead of playing it', () => {
    const play = vi.fn();
    const openDetail = vi.fn();
    openItemPage(catalogItem({ type: 'episode', content_id: 'e1', item_source: 'in_progress' }), {
      play,
      openDetail,
    });
    expect(openDetail).toHaveBeenCalledWith({ itemId: 'e1' });
    expect(play).not.toHaveBeenCalled();
  });

  it.each(['movie', 'series', 'season', 'episode'])('opens the page of a %s', (type) => {
    const openDetail = vi.fn();
    openItemPage(catalogItem({ type, content_id: 'x1' }), { play: vi.fn(), openDetail });
    expect(openDetail).toHaveBeenCalledWith({ itemId: 'x1' });
  });

  it('plays anything without a page of its own', () => {
    const play = vi.fn();
    const item = catalogItem({ type: 'audiobook' });
    openItemPage(item, { play, openDetail: vi.fn() });
    expect(play).toHaveBeenCalledWith(item, { kind: 'ask' });
  });
});

describe('playFeatured', () => {
  function playSlide(overrides: Partial<components['schemas']['CatalogItem']>) {
    const play = vi.fn();
    const openDetail = vi.fn();
    playFeatured(catalogItem(overrides), { play, openDetail });
    return { play, openDetail };
  }

  it('plays a movie from where it left off, without asking', () => {
    const { play, openDetail } = playSlide({ type: 'movie', content_id: 'm1', title: 'Heat' });
    expect(play).toHaveBeenCalledWith(
      expect.objectContaining({ content_id: 'm1', title: 'Heat' }),
      {
        kind: 'resume',
      },
    );
    expect(openDetail).not.toHaveBeenCalled();
  });

  it("plays a series' target episode under the series' title", () => {
    const { play } = playSlide({
      type: 'series',
      content_id: 's1',
      title: 'Severance',
      play_content_id: 'e9',
    });
    expect(play).toHaveBeenCalledWith(
      expect.objectContaining({ content_id: 'e9', title: 'Severance' }),
      { kind: 'resume' },
    );
  });

  it("plays a season's target episode", () => {
    const { play } = playSlide({ type: 'season', content_id: 'se1', play_content_id: 'e1' });
    expect(play).toHaveBeenCalledWith(expect.objectContaining({ content_id: 'e1' }), {
      kind: 'resume',
    });
  });

  it.each(['series', 'Season'])('opens the page of a %s that names no episode to play', (type) => {
    const { play, openDetail } = playSlide({ type, content_id: 's1' });
    expect(openDetail).toHaveBeenCalledWith({ itemId: 's1' });
    expect(play).not.toHaveBeenCalled();
  });
});
