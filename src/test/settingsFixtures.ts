// An MSW harness for the settings contract, typed against the generated schema: the capability
// document and the effective values of the keys the app reads.
import { HttpResponse, http } from 'msw';
import type { SetupServer } from 'msw/node';
import type { components } from '../api/generated/schema';
import { BASE_URL } from './apiFixtures';

type S = components['schemas'];

/** The contract defaults of the keys the app reads (what a server answers when nothing is stored). */
const SERVER_DEFAULTS: Record<string, unknown> = {
  'ui.title_art': true,
  'ui.time_format': 'auto',
  'ui.card_overlays': null,
  'ui.card_overlays_enabled': null,
  'catalog.hide_unwatched_episode_images': false,
  'catalog.hide_unwatched_episode_overviews': false,
  'ui.theme_music_enabled': false,
  'ui.theme_music_loop': false,
  'playback.auto_skip_intro': false,
  'playback.intro_skip_mode': 'ask',
  'playback.auto_skip_recap': false,
  'playback.auto_skip_credits': false,
  'playback.auto_play_next': true,
  'playback.next_up_prompt_seconds': 30,
  'playback.auto_play_next_preview': false,
  'playback.preferred_quality': 'auto',
  'playback.max_bitrate_kbps': null,
  'playback.buffering_quality_mode': 'always',
  'playback.subtitle_appearance': {
    fontSize: 'large',
    fontFamily: 'sans-serif',
    fontColor: '#ffffff',
    backgroundColor: '#000000',
    backgroundStyle: 'box',
    backgroundOpacity: 75,
    textOpacity: 100,
    textOutline: false,
    textOutlineColor: '#000000',
    position: 'bottom',
  },
  'playback.subtitle_mode': 'auto',
  'playback.subtitle_language': null,
  'playback.show_forced_subtitles': true,
  'player.video_skip_back_seconds': 10,
  'player.video_skip_forward_seconds': 30,
  'player.subtitle_sync_ms': 0,
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
  /** Only the overlay defaults wait for this (the profile's settings answer at once). */
  overlayGate?: Promise<void>;
  /** The server-wide card overlay defaults, or `fail` for a 500. */
  overlayConfig?: Partial<S['OverlayConfig']> | 'fail';
}

export interface SettingsCalls {
  capabilities: Request[];
  effective: Request[];
  overlayConfig: Request[];
}

const INTRODUCED_IN: Record<string, number> = {
  'ui.title_art': 16,
  'ui.time_format': 1,
  'ui.card_overlays': 1,
  'ui.card_overlays_enabled': 8,
  'catalog.hide_unwatched_episode_images': 17,
  'catalog.hide_unwatched_episode_overviews': 17,
  'ui.theme_music_enabled': 11,
  'ui.theme_music_loop': 11,
  'playback.auto_skip_intro': 1,
  'playback.intro_skip_mode': 7,
  'playback.auto_skip_recap': 1,
  'playback.auto_skip_credits': 1,
  'playback.auto_play_next': 1,
  'playback.next_up_prompt_seconds': 1,
  'playback.auto_play_next_preview': 1,
  'playback.preferred_quality': 1,
  'playback.max_bitrate_kbps': 1,
  'playback.buffering_quality_mode': 23,
  'playback.subtitle_appearance': 1,
  'playback.subtitle_mode': 1,
  'playback.subtitle_language': 1,
  'playback.show_forced_subtitles': 1,
  'player.video_skip_back_seconds': 9,
  'player.video_skip_forward_seconds': 9,
  'player.subtitle_sync_ms': 1,
};

/** Registers the two settings reads; the returned object records the requests. */
export function serveSettings(server: SetupServer, options: SettingsServe = {}): SettingsCalls {
  const calls: SettingsCalls = { capabilities: [], effective: [], overlayConfig: [] };
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
    http.get(`${BASE_URL}/api/v2/settings/overlay-config`, async ({ request }) => {
      calls.overlayConfig.push(request.clone());
      await options.gate;
      await options.overlayGate;
      if (options.overlayConfig === 'fail') return new HttpResponse(null, { status: 500 });
      const document: S['OverlayConfig'] = {
        enabled: true,
        image_uploads_available: false,
        images: [],
        quick_actions_default: 'both',
        quick_actions_enabled: false,
        ...options.overlayConfig,
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
