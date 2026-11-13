// Typed fixtures for the progress and section-recipe responses, typed against the generated schema
// like the other fixtures.
import type { components } from '../api/generated/schema';

type S = components['schemas'];

export function progressEntry(
  mediaItemId: string,
  overrides: Partial<S['ProgressEntry']> = {},
): S['ProgressEntry'] {
  return {
    completed: false,
    duration_seconds: 3600,
    media_item_id: mediaItemId,
    position_seconds: 600,
    updated_at: '2026-01-02T03:04:05.000Z',
    ...overrides,
  };
}

export function progressCollection(items: S['ProgressEntry'][] = []): S['ProgressCollection'] {
  return { items };
}

export function progressCapabilities(
  overrides: Partial<S['ProgressCapabilities']> = {},
): S['ProgressCapabilities'] {
  return {
    allowed: true,
    clear_resume_position: true,
    mark_watched_records_rewatch: true,
    revision: 'r1',
    state: 'available',
    ...overrides,
  };
}

/** A catalogue with one recipe of the given type, with the duplicate flag as given. */
export function recipeCatalog(type: string, avoidDuplicates = true): S['RecipeCatalog'] {
  return {
    categories: [
      {
        category: 'personal',
        recipes: [
          {
            admin_only: false,
            avoid_duplicates: avoidDuplicates,
            category: 'personal',
            presets: [],
            supports_rotation: false,
            type,
          },
        ],
      },
    ],
  };
}
