// An MSW harness for AI translation on view, typed against the generated schema: the metadata-AI
// capability document and the viewer's translate-description request.
import { HttpResponse, http } from 'msw';
import type { SetupServer } from 'msw/node';
import type { components } from '../api/generated/schema';
import { BASE_URL } from './apiFixtures';

type S = components['schemas'];

export function translationJob(
  overrides: Partial<S['MetadataTranslationJob']> = {},
): S['MetadataTranslationJob'] {
  return {
    content_id: 'm1',
    created_at: '2026-01-01T00:00:00.000Z',
    engine: 'test',
    fields_done: 0,
    fields_total: 1,
    force: false,
    id: '42',
    include_children: false,
    model: 'test',
    progress: 0,
    progress_message: '',
    source_language: 'en',
    status: 'pending',
    target_kind: 'item',
    target_language: 'de',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export interface TranslationServe {
  /** Overrides of the capability document, or `fail` for a 500. Off (disabled) when omitted. */
  capability?: Partial<S['MetadataAICapability']> | 'fail';
  /**
   * Answers a translate request: a job (202), or `{ problem }` (the HTTP status) for a problem answer (422, 429, 500).
   * Defaults to an accepted, pending job.
   */
  translate?: (
    id: string,
    body: S['TranslateDescription'],
  ) => Partial<S['MetadataTranslationJob']> | { problem: number };
}

export interface TranslationCalls {
  /** Every translate request: the content id and the body exactly as sent. */
  posts: { id: string; body: S['TranslateDescription'] }[];
  capabilities: number;
}

/** Registers the capability and the translate request; the returned object records what came in. */
export function serveTranslation(
  server: SetupServer,
  options: TranslationServe = {},
): TranslationCalls {
  const calls: TranslationCalls = { posts: [], capabilities: 0 };
  server.use(
    http.get(`${BASE_URL}/api/v2/capabilities/metadata-ai`, () => {
      calls.capabilities += 1;
      if (options.capability === 'fail') return new HttpResponse(null, { status: 500 });
      return HttpResponse.json({
        allowed: true,
        on_view: 'off',
        revision: 'r1',
        state: options.capability ? 'available' : 'disabled',
        ...options.capability,
      } satisfies S['MetadataAICapability']);
    }),
    http.post(
      `${BASE_URL}/api/v2/catalog/items/:id/translate-description`,
      async ({ params, request }) => {
        const body = (await request.json()) as S['TranslateDescription'];
        const id = String(params.id);
        calls.posts.push({ id, body });
        const answer = options.translate?.(id, body) ?? {};
        if ('problem' in answer) {
          return HttpResponse.json(
            { type: 'about:blank', title: 'refused', status: answer.problem },
            { status: answer.problem, headers: { 'Content-Type': 'application/problem+json' } },
          );
        }
        return HttpResponse.json(translationJob({ content_id: id, ...answer }), { status: 202 });
      },
    ),
  );
  return calls;
}
