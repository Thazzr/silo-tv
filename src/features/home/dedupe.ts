import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import { useSilo } from '../../app/SiloContext';

const NO_TYPES: ReadonlySet<string> = new Set();

/** What the rule needs of a section; Home and library sections both have it. */
interface Dedupable {
  section_type: string;
  total_count: number;
  items: { content_id: string }[];
}

/**
 * Applies the recipes' avoid_duplicates rule, as Silo's web app does: the sections are visited in
 * layout order, each marks its cards as seen by `content_id`, and a section whose type avoids
 * duplicates first drops the cards an earlier section shows. Other types keep every card (and
 * still mark theirs), so a row like "trending" is not thinned out by the rows above it. A section
 * that loses cards has its `total_count` reduced by that many, never below what it still shows;
 * unchanged sections keep their identity, so memoised rows do not redraw.
 */
export function dropDuplicateCards<T extends Dedupable>(
  sections: readonly T[],
  avoidDuplicateTypes: ReadonlySet<string>,
): readonly T[] {
  if (avoidDuplicateTypes.size === 0) return sections;
  const seen = new Set<string>();
  return sections.map((section) => {
    const kept = avoidDuplicateTypes.has(section.section_type)
      ? section.items.filter((item) => !seen.has(item.content_id))
      : section.items;
    for (const item of kept) {
      if (item.content_id) seen.add(item.content_id);
    }
    const dropped = section.items.length - kept.length;
    if (dropped === 0) return section;
    return {
      ...section,
      items: kept,
      total_count: Math.max(kept.length, section.total_count - dropped),
    };
  });
}

/**
 * The section types whose recipe sets avoid_duplicates, from the recipe gallery. Until it loads,
 * or if it fails, no type avoids duplicates and rows show as served.
 */
function useAvoidDuplicateTypes(): ReadonlySet<string> {
  const { client, baseUrl } = useSilo();
  const { data } = useQuery({
    queryKey: ['section-recipes', baseUrl],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/sections/recipes');
      if (!data) throw toApiError(error, response);
      return data;
    },
  });
  return useMemo(() => {
    if (!data) return NO_TYPES;
    const types = new Set<string>();
    for (const { recipes } of data.categories) {
      for (const recipe of recipes) {
        if (recipe.avoid_duplicates) types.add(recipe.type);
      }
    }
    return types;
  }, [data]);
}

/** `dropDuplicateCards` over the given sections, rerun when they or the recipe gallery change. */
export function useDedupedSections<T extends Dedupable>(sections: readonly T[]): readonly T[] {
  const types = useAvoidDuplicateTypes();
  return useMemo(() => dropDuplicateCards(sections, types), [sections, types]);
}
