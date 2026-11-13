// What the end screen's On Deck row reads: the in-progress list and the detail of each entry.
import { HttpResponse, http } from 'msw';
import type { SetupServer } from 'msw/node';
import type { components } from '../api/generated/schema';
import { BASE_URL } from './apiFixtures';
import { itemDetail } from './detailFixtures';
import { progressCollection, progressEntry } from './progressFixtures';

type S = components['schemas'];

export interface OnDeckEntry {
  entry: S['ProgressEntry'];
  /** The item's detail; 'fail' answers its read with a server error. */
  detail: S['CatalogItemDetail'] | 'fail';
}

/** An in-progress episode of another series: its progress entry and its detail. */
export function onDeckEpisode(
  id: string,
  detail: Partial<S['CatalogItemDetail']> = {},
  progress: Partial<S['ProgressEntry']> = {},
): OnDeckEntry {
  return {
    entry: progressEntry(id, progress),
    detail: itemDetail({
      content_id: id,
      type: 'episode',
      title: `Pilot ${id}`,
      series_title: `Show ${id}`,
      series_id: `series-${id}`,
      season_number: 1,
      episode_number: 3,
      backdrop_url: `/img/${id}-backdrop.webp`,
      ...detail,
    }),
  };
}

export interface OnDeckServe {
  entries?: OnDeckEntry[];
  /** The list read fails, or waits for this before it answers. */
  list?: 'fail' | Promise<void>;
}

export interface OnDeckCalls {
  /** The query strings of the list reads. */
  lists: URLSearchParams[];
  /** The ids of the detail reads. */
  details: string[];
}

/** Registers the progress list and the item details of the given entries, in this order. */
export function serveOnDeck(server: SetupServer, options: OnDeckServe = {}): OnDeckCalls {
  const entries = options.entries ?? [];
  const calls: OnDeckCalls = { lists: [], details: [] };
  server.use(
    http.get(`${BASE_URL}/api/v2/progress`, async ({ request }) => {
      calls.lists.push(new URL(request.url).searchParams);
      if (options.list === 'fail') return new HttpResponse(null, { status: 500 });
      if (options.list) await options.list;
      return HttpResponse.json(progressCollection(entries.map((e) => e.entry)));
    }),
    http.get(`${BASE_URL}/api/v2/catalog/items/:id`, ({ params }) => {
      const id = String(params.id);
      calls.details.push(id);
      const found = entries.find((e) => e.entry.media_item_id === id);
      if (!found || found.detail === 'fail') return new HttpResponse(null, { status: 500 });
      return HttpResponse.json(found.detail);
    }),
  );
  return calls;
}
