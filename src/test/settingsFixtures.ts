// An MSW harness for the settings contract, typed against the generated schema: the capability
// document and the effective values of the keys the app reads.
import { HttpResponse, http } from 'msw';
import type { SetupServer } from 'msw/node';
import type { components } from '../api/generated/schema';
import { BASE_URL } from './apiFixtures';

type S = components['schemas'];

/** The contract defaults of the keys the app reads (what a server answers when nothing is stored). */
const SERVER_DEFAULTS: Record<string, boolean> = {
  'ui.title_art': true,
  'catalog.hide_unwatched_episode_images': false,
  'catalog.hide_unwatched_episode_overviews': false,
  'ui.theme_music_enabled': false,
  'ui.theme_music_loop': false,
};

export interface SettingsServe {
  /** The server's manifest revision; every key introduced later is unknown to it (a 422). */
  manifestRevision?: number;
  /** Introduced-in revision per key, as the server's manifest has them. */
  introducedIn?: Record<string, number>;
  /** Overrides of the capability document, or `fail` for a 500. */
  capabilities?: Partial<S['SettingsContractCapabilities']> | 'fail';
  /** The stored values of the profile (any key; the rest answer the contract default). */
  values?: Record<string, unknown>;
  /** `fail` answers the effective read with a 500. */
  effective?: 'fail';
  /** The reads wait for this before answering, to look at the state while they are in flight. */
  gate?: Promise<void>;
}

export interface SettingsCalls {
  capabilities: Request[];
  effective: Request[];
}

const INTRODUCED_IN: Record<string, number> = {
  'ui.title_art': 16,
  'catalog.hide_unwatched_episode_images': 17,
  'catalog.hide_unwatched_episode_overviews': 17,
  'ui.theme_music_enabled': 11,
  'ui.theme_music_loop': 11,
};

/** Registers the two settings reads; the returned object records the requests. */
export function serveSettings(server: SetupServer, options: SettingsServe = {}): SettingsCalls {
  const calls: SettingsCalls = { capabilities: [], effective: [] };
  const revision = options.manifestRevision ?? 40;
  const introduced = options.introducedIn ?? INTRODUCED_IN;
  server.use(
    http.get(`${BASE_URL}/api/v2/settings/contract/capabilities`, async ({ request }) => {
      calls.capabilities.push(request.clone());
      await options.gate;
      if (options.capabilities === 'fail') return new HttpResponse(null, { status: 500 });
      const document: S['SettingsContractCapabilities'] = {
        api_version: 1,
        client_families: ['tv', 'web'],
        contract_etag: '"etag"',
        definition_count: 40,
        manifest_revision: revision,
        revision: 'r1',
        scopes: ['account', 'profile'],
        state: 'available',
        allowed: true,
        supports_atomic_shortcuts: true,
        supports_batched_effective: true,
        supports_device_rename: true,
        supports_idempotent_writes: true,
        supports_overlay_images: false,
        ...options.capabilities,
      };
      return HttpResponse.json(document);
    }),
    http.get(`${BASE_URL}/api/v2/settings/values/effective`, async ({ request }) => {
      calls.effective.push(request.clone());
      await options.gate;
      if (options.effective === 'fail') return new HttpResponse(null, { status: 500 });
      const keys = new URL(request.url).searchParams.getAll('keys');
      // One key the manifest does not know fails the whole read, as on the real server.
      if (keys.some((key) => (introduced[key] ?? Infinity) > revision)) {
        return HttpResponse.json(
          { type: 'about:blank', title: 'Unprocessable Entity', status: 422 },
          { status: 422 },
        );
      }
      const body: S['EffectiveSettingCollection'] = {
        items: keys.map((key) => {
          const stored = options.values !== undefined && key in options.values;
          return {
            key,
            value: stored ? options.values![key] : SERVER_DEFAULTS[key],
            source: stored ? 'profile' : 'default',
            definition_revision: 1,
          };
        }),
        revision,
      };
      return HttpResponse.json(body);
    }),
  );
  return calls;
}
