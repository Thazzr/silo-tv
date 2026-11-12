import type { CatalogItem } from '../../ui/media';

/** Slides of the carousel when the section does not say how many its layout allows. */
export const FEATURED_DEFAULT_SLIDES = 10;

/** The section that is the hero carousel: the first one of the layout that is flagged `featured`. */
export function firstFeatured<S extends { featured: boolean }>(
  sections: readonly S[],
): S | undefined {
  return sections.find((section) => section.featured);
}

/**
 * The slides of a featured section: its items up to the layout's limit (10 without one). A mixed
 * library passes the kind of its tab, so the other kind is not a slide.
 */
export function featuredSlides(
  section: { item_limit: number; items: readonly CatalogItem[] },
  kind?: 'movie' | 'series',
): CatalogItem[] {
  const kept = kind
    ? section.items.filter((item) => item.type.trim().toLowerCase() === kind)
    : section.items;
  return kept.slice(0, section.item_limit > 0 ? section.item_limit : FEATURED_DEFAULT_SLIDES);
}
