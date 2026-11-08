// Typed fixtures for the app flow (device sign-in, profiles, libraries, catalog), typed against
// the generated schema like apiFixtures.ts.
import type { components } from '../api/generated/schema';

type S = components['schemas'];

export const capability: S['DeviceLoginCapability'] = {
  allowed: true,
  cancel: true,
  jellyfin_quick_connect: false,
  opened_signal: true,
  protocol_versions: [2],
  remote_playback_handoff: false,
  revision: 'r1',
  session_binding: true,
  state: 'available',
};

/** `expires_at` follows the (possibly faked) clock so the local deadline never fires early. */
export function deviceStart(overrides: Partial<S['DeviceLoginStart']> = {}): S['DeviceLoginStart'] {
  return {
    client_purpose: 'device_login',
    device_code: 'device-code-1',
    device_name: 'LG webOS TV',
    device_platform: 'webos',
    expires_at: new Date(Date.now() + 900_000).toISOString(),
    expires_in: 900,
    interval: 5,
    match_code: 'warm pony',
    temporary: false,
    user_code: '4821-7730',
    verification_uri: 'https://silo.example.test/activate',
    verification_uri_complete: 'https://silo.example.test/activate?code=48217730',
    ...overrides,
  };
}

export function devicePoll(overrides: Partial<S['DeviceLoginPoll']> = {}): S['DeviceLoginPoll'] {
  return {
    opened: false,
    poll_after: 5,
    profile_id: '',
    profile_token: '',
    status: 'pending',
    temporary: false,
    ...overrides,
  };
}

export const tokenPair: S['TokenPair'] = {
  access_token: 'access-token-1',
  expires_in: 3600,
  refresh_token: 'refresh-token-1',
  user: {
    download_allowed: true,
    email: 'viewer@example.test',
    id: 'user-1',
    password_change_required: false,
    permissions: [],
    role: 'user',
    username: 'viewer',
  },
};

export function profile(overrides: Partial<S['Profile']> = {}): S['Profile'] {
  return {
    allowed_library_ids: [],
    auto_play_next_preview: false,
    auto_skip_credits: false,
    auto_skip_intro: true,
    auto_skip_recap: false,
    avatar: '',
    avatar_source: 'none',
    created_at: '2026-01-01T00:00:00.000Z',
    has_pin: false,
    id: 'profile-1',
    is_child: false,
    is_primary: true,
    language: 'en',
    library_restrictions_enabled: false,
    max_advisory_age: null,
    max_content_rating: '',
    max_playback_quality: 'original',
    name: 'Alex',
    preferred_metadata_language: 'en',
    quality_preference: 'auto',
    require_advisory_age: false,
    show_forced_subtitles: false,
    subtitle_language: 'en',
    subtitle_mode: 'auto',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function profileCollection(items: S['Profile'][]): S['ProfileCollection'] {
  return {
    avatar_upload_enabled: false,
    items,
    max_advisory_age_supported: true,
    require_advisory_age_supported: true,
  };
}

export function library(overrides: Partial<S['UserLibrary']> = {}): S['UserLibrary'] {
  return {
    box_sets_enabled: false,
    id: 'lib-1',
    name: 'Movies',
    sort_order: 1,
    type: 'movies',
    ...overrides,
  };
}

export function catalogItem(overrides: Partial<S['CatalogItem']> = {}): S['CatalogItem'] {
  return {
    content_id: 'item-1',
    genres: [],
    keywords: [],
    status: 'matched',
    title: 'First Title',
    type: 'movie',
    year: 2019,
    ...overrides,
  };
}

export function catalogPage(items: S['CatalogItem'][]): S['CatalogBrowseCollection'] {
  return { items, total: items.length, total_exact: true, window_cursor: 'cursor' };
}
