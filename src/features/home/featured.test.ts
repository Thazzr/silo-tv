import { describe, expect, it } from 'vitest';
import { catalogItem } from '../../test/flowFixtures';
import { featuredSlides, firstFeatured, FEATURED_DEFAULT_SLIDES } from './featured';

const items = (count: number, type = 'movie') =>
  Array.from({ length: count }, (_, i) => catalogItem({ content_id: `${type}-${i + 1}`, type }));

describe('firstFeatured', () => {
  it('is the first section flagged featured, whatever comes before and after it', () => {
    const sections = [
      { id: 'a', featured: false },
      { id: 'b', featured: true },
      { id: 'c', featured: true },
    ];
    expect(firstFeatured(sections)?.id).toBe('b');
  });

  it('is nothing without a featured section', () => {
    expect(firstFeatured([{ id: 'a', featured: false }])).toBeUndefined();
    expect(firstFeatured([])).toBeUndefined();
  });
});

describe('featuredSlides', () => {
  it('cuts the items to the layout item limit', () => {
    const slides = featuredSlides({ item_limit: 4, items: items(12) });
    expect(slides.map((slide) => slide.content_id)).toEqual([
      'movie-1',
      'movie-2',
      'movie-3',
      'movie-4',
    ]);
  });

  it('shows ten without a usable limit', () => {
    expect(FEATURED_DEFAULT_SLIDES).toBe(10);
    expect(featuredSlides({ item_limit: 0, items: items(14) })).toHaveLength(10);
    expect(featuredSlides({ item_limit: -1, items: items(14) })).toHaveLength(10);
  });

  it('keeps all items when there are fewer than the limit', () => {
    expect(featuredSlides({ item_limit: 10, items: items(3) })).toHaveLength(3);
  });

  it("keeps only the tab's kind of a mixed library, and cuts after that", () => {
    const mixed = [...items(3, 'series'), ...items(5, 'movie')];
    const movies = featuredSlides({ item_limit: 4, items: mixed }, 'movie');
    expect(movies.map((slide) => slide.content_id)).toEqual([
      'movie-1',
      'movie-2',
      'movie-3',
      'movie-4',
    ]);
    expect(featuredSlides({ item_limit: 10, items: mixed }, 'series')).toHaveLength(3);
  });

  it('reads the kind with stray spaces and capitals', () => {
    const slides = featuredSlides(
      {
        item_limit: 10,
        items: [catalogItem({ type: ' Movie ' }), catalogItem({ type: 'series' })],
      },
      'movie',
    );
    expect(slides).toHaveLength(1);
  });
});
