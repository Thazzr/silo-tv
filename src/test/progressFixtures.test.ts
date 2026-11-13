import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  progressCapabilities,
  progressCollection,
  progressEntry,
  recipeCatalog,
} from './progressFixtures';

interface Spec {
  paths: Record<string, Record<string, { operationId?: string }>>;
}

describe('pinned progress and recipe operations', () => {
  it('are in the slim spec under their operation ids', () => {
    const spec = JSON.parse(readFileSync('openapi/silo-v2.json', 'utf-8')) as Spec;
    expect(spec.paths['/api/v2/progress']?.get?.operationId).toBe('listProgress');
    expect(spec.paths['/api/v2/progress/capabilities']?.get?.operationId).toBe(
      'getProgressCapabilities',
    );
    expect(spec.paths['/api/v2/sections/recipes']?.get?.operationId).toBe('listSectionRecipes');
  });

  it('have fixtures that take overrides', () => {
    expect(progressCollection([progressEntry('m1', { completed: true })]).items[0]).toMatchObject({
      media_item_id: 'm1',
      completed: true,
    });
    expect(progressCapabilities({ state: 'disabled' }).state).toBe('disabled');
    expect(recipeCatalog('continue_watching', false).categories[0]?.recipes[0]).toMatchObject({
      type: 'continue_watching',
      avoid_duplicates: false,
    });
  });
});
