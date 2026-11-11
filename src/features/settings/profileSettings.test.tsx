import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HttpResponse, http } from 'msw';
import { Session } from '../../api/session';
import { getPlatform, setPlatformForTests } from '../../platform';
import { account, BASE_URL } from '../../test/apiFixtures';
import { memoryStorage, newQueryClient, renderWithSilo } from '../../test/renderFlow';
import { serveSettings } from '../../test/settingsFixtures';
import {
  DEFAULT_SUBTITLE_APPEARANCE,
  defaultSettings,
  keysKnownAt,
  PROFILE_SETTINGS,
  ProfileSettingsSync,
  settingValuesFrom,
  useProfileSetting,
  useProfileSettings,
  useResetProfileDeviceSetting,
  useServerKnowsSetting,
  useSetProfileSettingAt,
} from './profileSettings';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  setPlatformForTests(null);
});
afterAll(() => server.close());

function sessionOf(profileId: string | null = 'p1'): Session {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: profileId ?? undefined,
  });
  return session;
}

/** Shows what one consumer gets: the value of the title-art key and whether it is known. */
function Consumer({ name = 'consumer' }: { name?: string }) {
  const { value, known } = useProfileSetting('ui.title_art');
  return (
    <div data-testid={name}>
      {String(value)}|{known ? 'known' : 'unknown'}
    </div>
  );
}

function AllValues() {
  const { values, known } = useProfileSettings();
  return <div data-testid="all">{known ? JSON.stringify(values) : 'unknown'}</div>;
}

const shows = (name: string, text: string) =>
  waitFor(() => expect(screen.getByTestId(name)).toHaveTextContent(text));

describe('ui.time_format', () => {
  const timeFormat = () => JSON.parse(screen.getByTestId('all').textContent!)['ui.time_format'];

  it('is introduced at manifest revision 1 and is a closed set with default auto', () => {
    expect(keysKnownAt(0)).not.toContain('ui.time_format');
    expect(keysKnownAt(1)).toContain('ui.time_format');
    expect(PROFILE_SETTINGS['ui.time_format'].default).toBe('auto');
    for (const value of ['auto', '12h', '24h']) {
      expect(PROFILE_SETTINGS['ui.time_format'].parse(value)).toBe(value);
    }
    expect(PROFILE_SETTINGS['ui.time_format'].parse('36h')).toBeUndefined();
    expect(PROFILE_SETTINGS['ui.time_format'].parse(12)).toBeUndefined();
  });

  it.each(['12h', '24h', 'auto'])('reads a stored %s as it is', async (stored) => {
    serveSettings(server, { values: { 'ui.time_format': stored } });
    renderWithSilo(<AllValues />, { session: sessionOf() });
    await waitFor(() => expect(timeFormat()).toBe(stored));
  });

  it('falls back to auto for a stored value outside the set', async () => {
    serveSettings(server, { values: { 'ui.time_format': '36h' } });
    renderWithSilo(<AllValues />, { session: sessionOf() });
    await shows('all', '"ui.time_format":"auto"');
  });

  it('reads auto when the answer has no such key, and when the read fails', async () => {
    serveSettings(server, {});
    server.use(
      http.get(`${BASE_URL}/api/v2/settings/values/effective`, () =>
        HttpResponse.json({ items: [], revision: 40 }),
      ),
    );
    renderWithSilo(<AllValues />, { session: sessionOf() });
    await shows('all', '"ui.time_format":"auto"');
    cleanup();
    serveSettings(server, { effective: 'fail' });
    renderWithSilo(<AllValues />, { session: sessionOf() });
    await shows('all', '"ui.time_format":"auto"');
  });
});

describe('keysKnownAt', () => {
  it('lists only the keys a manifest revision knows', () => {
    expect(keysKnownAt(0)).toEqual(['playback.auto_skip_intro']);
    expect(keysKnownAt(10)).toContain('playback.intro_skip_mode');
    expect(keysKnownAt(10)).not.toContain('ui.theme_music_enabled');
    expect(keysKnownAt(10)).not.toContain('ui.title_art');
    expect(keysKnownAt(11)).toContain('ui.theme_music_enabled');
    expect(keysKnownAt(16)).toContain('ui.title_art');
    expect(keysKnownAt(16)).not.toContain('catalog.hide_unwatched_episode_images');
    expect(keysKnownAt(17)).toContain('catalog.hide_unwatched_episode_images');
    expect(keysKnownAt(40)).toHaveLength(22);
  });

  it('gates the player keys by their revisions and swaps the intro key at revision 7', () => {
    const at6 = keysKnownAt(6);
    expect(at6).toContain('playback.auto_skip_intro');
    expect(at6).not.toContain('playback.intro_skip_mode');
    expect(at6).toContain('playback.subtitle_appearance');
    expect(at6).not.toContain('player.video_skip_back_seconds');
    const at7 = keysKnownAt(7);
    expect(at7).toContain('playback.intro_skip_mode');
    expect(at7).not.toContain('playback.auto_skip_intro');
    expect(keysKnownAt(8)).not.toContain('player.video_skip_forward_seconds');
    expect(keysKnownAt(9)).toContain('player.video_skip_forward_seconds');
  });

  it('knows the buffering-quality mode from revision 23 on', () => {
    expect(keysKnownAt(22)).not.toContain('playback.buffering_quality_mode');
    expect(keysKnownAt(23)).toContain('playback.buffering_quality_mode');
  });

  it('asks for the subtitle delay from revision 1 on, and no longer for the dropped sleep timer', () => {
    expect(keysKnownAt(1)).toContain('player.subtitle_sync_ms');
    expect(keysKnownAt(40)).not.toContain('player.sleep_timer_default_minutes');
    expect(Object.keys(PROFILE_SETTINGS)).not.toContain('player.sleep_timer_default_minutes');
    expect(Object.keys(defaultSettings())).not.toContain('player.sleep_timer_default_minutes');
  });

  it('has the contract defaults for every key', () => {
    expect(defaultSettings()).toMatchObject({
      'playback.intro_skip_mode': 'ask',
      'playback.auto_skip_recap': false,
      'playback.auto_skip_credits': false,
      'playback.auto_play_next': true,
      'playback.next_up_prompt_seconds': 30,
      'playback.auto_play_next_preview': false,
      'playback.preferred_quality': 'auto',
      'playback.max_bitrate_kbps': null,
      'playback.buffering_quality_mode': 'always',
      'player.video_skip_back_seconds': 10,
      'player.video_skip_forward_seconds': 30,
      'player.subtitle_sync_ms': 0,
      'playback.subtitle_appearance': DEFAULT_SUBTITLE_APPEARANCE,
      'playback.subtitle_mode': 'auto',
      'playback.subtitle_language': null,
      'playback.show_forced_subtitles': true,
    });
  });

  it('knows the subtitle start settings from revision 1 on', () => {
    for (const key of [
      'playback.subtitle_mode',
      'playback.subtitle_language',
      'playback.show_forced_subtitles',
    ]) {
      expect(keysKnownAt(1)).toContain(key);
      expect(keysKnownAt(0)).not.toContain(key);
    }
  });

  it.each([
    ['playback.next_up_prompt_seconds', 45, 45],
    ['playback.next_up_prompt_seconds', 0, 0],
    ['playback.next_up_prompt_seconds', 121, 30],
    ['playback.next_up_prompt_seconds', -1, 30],
    ['playback.next_up_prompt_seconds', 12.5, 30],
    ['playback.next_up_prompt_seconds', '45', 30],
    ['player.subtitle_sync_ms', 10000, 10000],
    ['player.subtitle_sync_ms', -10000, -10000],
    ['player.subtitle_sync_ms', 300, 300],
    ['player.subtitle_sync_ms', 10001, 0],
    ['player.subtitle_sync_ms', -10001, 0],
    ['player.subtitle_sync_ms', 12.5, 0],
    ['player.subtitle_sync_ms', '300', 0],
    ['playback.intro_skip_mode', 'never', 'never'],
    ['playback.intro_skip_mode', 'sometimes', 'ask'],
    ['playback.intro_skip_mode', true, 'ask'],
    ['playback.preferred_quality', '1080p', '1080p'],
    ['playback.preferred_quality', '4k', 'auto'],
    ['playback.max_bitrate_kbps', 100, 100],
    ['playback.max_bitrate_kbps', 200000, 200000],
    ['playback.max_bitrate_kbps', 8000, 8000],
    ['playback.max_bitrate_kbps', 99, null],
    ['playback.max_bitrate_kbps', 200001, null],
    ['playback.max_bitrate_kbps', 8000.5, null],
    ['playback.max_bitrate_kbps', null, null],
    ['playback.max_bitrate_kbps', '8000', null],
    ['playback.max_bitrate_kbps', true, null],
    ['playback.buffering_quality_mode', 'never', 'never'],
    ['playback.buffering_quality_mode', 'ask', 'ask'],
    ['playback.buffering_quality_mode', 'always', 'always'],
    ['playback.buffering_quality_mode', 'sometimes', 'always'],
    ['playback.buffering_quality_mode', 'Never', 'always'],
    ['playback.buffering_quality_mode', 'ask ', 'always'],
    ['playback.buffering_quality_mode', '', 'always'],
    ['playback.buffering_quality_mode', 0, 'always'],
    ['playback.buffering_quality_mode', true, 'always'],
    ['playback.buffering_quality_mode', null, 'always'],
    ['player.video_skip_back_seconds', 15, 15],
    ['player.video_skip_back_seconds', 12, 10],
    ['player.video_skip_forward_seconds', '30', 30],
    ['player.video_skip_forward_seconds', 61, 30],
    ['playback.auto_play_next', false, false],
    ['playback.auto_play_next', 'false', true],
    ['playback.auto_skip_credits', 1, false],
    ['playback.auto_skip_credits', 'true', false],
    ['playback.auto_skip_credits', 0, false],
    ['playback.auto_skip_credits', null, false],
    ['playback.subtitle_mode', 'always', 'always'],
    ['playback.subtitle_mode', 'off', 'off'],
    ['playback.subtitle_mode', 'auto', 'auto'],
    ['playback.subtitle_mode', 'Always', 'auto'],
    ['playback.subtitle_mode', '', 'auto'],
    ['playback.subtitle_mode', null, 'auto'],
    ['playback.subtitle_language', 'de', 'de'],
    ['playback.subtitle_language', 'pt-BR', 'pt-BR'],
    ['playback.subtitle_language', null, null],
    ['playback.subtitle_language', 7, null],
    ['playback.show_forced_subtitles', false, false],
    ['playback.show_forced_subtitles', true, true],
    ['playback.show_forced_subtitles', 'false', true],
    ['playback.show_forced_subtitles', null, true],
  ])('parses %s = %j to %j', (key, raw, expected) => {
    expect(settingValuesFrom([{ key, value: raw }])).toMatchObject({ [key]: expected });
  });

  it('falls back to the deprecated intro boolean when the enum is not answered', () => {
    const mode = (items: { key: string; value: unknown }[]) =>
      settingValuesFrom(items)['playback.intro_skip_mode'];
    expect(mode([{ key: 'playback.auto_skip_intro', value: true }])).toBe('always');
    expect(mode([{ key: 'playback.auto_skip_intro', value: false }])).toBe('ask');
    // A usable enum wins over the boolean.
    expect(
      mode([
        { key: 'playback.auto_skip_intro', value: true },
        { key: 'playback.intro_skip_mode', value: 'never' },
      ]),
    ).toBe('never');
    // An unusable enum lets the boolean speak; an unusable boolean leaves the default.
    expect(
      mode([
        { key: 'playback.auto_skip_intro', value: true },
        { key: 'playback.intro_skip_mode', value: 'bogus' },
      ]),
    ).toBe('always');
    expect(mode([{ key: 'playback.auto_skip_intro', value: 'yes' }])).toBe('ask');
  });

  it('merges a sparse subtitle appearance over the default', () => {
    const merged = settingValuesFrom([
      { key: 'playback.subtitle_appearance', value: { fontSize: 'xxlarge', position: 'top' } },
    ])['playback.subtitle_appearance'];
    expect(merged).toEqual({
      ...DEFAULT_SUBTITLE_APPEARANCE,
      fontSize: 'xxlarge',
      position: 'top',
    });
  });

  it('falls back per field for invalid or unknown subtitle appearance fields', () => {
    const merged = settingValuesFrom([
      {
        key: 'playback.subtitle_appearance',
        value: {
          fontSize: 'huge',
          fontColor: 'red',
          backgroundColor: '#12ab9F',
          backgroundStyle: 'shadow',
          backgroundOpacity: 101,
          textOpacity: 0,
          textOutline: 'yes',
          textOutlineColor: '#fff',
          position: 'lower-third',
          fontFamily: 'Roboto',
          extra: 1,
        },
      },
    ])['playback.subtitle_appearance'];
    expect(merged).toEqual({
      ...DEFAULT_SUBTITLE_APPEARANCE,
      backgroundColor: '#12ab9F',
      backgroundStyle: 'shadow',
      position: 'lower-third',
      fontFamily: 'Roboto',
    });
    expect(merged).not.toHaveProperty('extra');
  });

  it.each([null, 'large', 7, ['x']])('uses the default appearance for the value %j', (raw) => {
    expect(
      settingValuesFrom([{ key: 'playback.subtitle_appearance', value: raw }])[
        'playback.subtitle_appearance'
      ],
    ).toEqual(DEFAULT_SUBTITLE_APPEARANCE);
  });

  it('rejects a font family that is not safe to put into CSS', () => {
    const family = (value: string) =>
      settingValuesFrom([{ key: 'playback.subtitle_appearance', value: { fontFamily: value } }])[
        'playback.subtitle_appearance'
      ].fontFamily;
    expect(family('a;b')).toBe('sans-serif');
    expect(family('')).toBe('sans-serif');
    expect(family('x'.repeat(65))).toBe('sans-serif');
    expect(family('Noto Sans')).toBe('Noto Sans');
  });

  it('settingValuesFrom ignores unknown keys and values of the wrong type', () => {
    const values = settingValuesFrom([
      { key: 'ui.title_art', value: 'no' },
      { key: 'ui.theme_music_loop', value: true },
      { key: 'something.else', value: true },
    ]);
    expect(values['ui.title_art']).toBe(true);
    expect(values['ui.theme_music_loop']).toBe(true);
    expect(Object.keys(values)).not.toContain('something.else');
  });
});

describe('useProfileSetting', () => {
  it('asks once with repeated keys parameters and the TV client family, then answers', async () => {
    const calls = serveSettings(server, { values: { 'ui.title_art': false } });
    renderWithSilo(<Consumer />, { session: sessionOf() });
    await shows('consumer', 'false|known');

    const [capabilities] = calls.capabilities;
    expect(capabilities!.headers.get('X-Silo-Client-Family')).toBe('tv');
    expect(capabilities!.headers.get('X-Profile-Id')).toBe('p1');
    expect(calls.effective).toHaveLength(1);
    const request = calls.effective[0]!;
    expect(request.headers.get('X-Silo-Client-Family')).toBe('tv');
    expect(request.headers.get('X-Silo-Device-Id')).toBeTruthy();
    expect(request.headers.get('X-Profile-Id')).toBe('p1');
    const url = new URL(request.url);
    expect(url.searchParams.getAll('keys')).toEqual(keysKnownAt(40));
    expect(url.searchParams.getAll('keys')).toHaveLength(22);
    // Repeated, never comma-separated.
    expect(url.search).not.toMatch(/,|%2C/i);
    expect(url.search.match(/keys=/g)).toHaveLength(22);
  });

  it('is not known while the read is in flight, and reports the default meanwhile', async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    serveSettings(server, { gate, values: { 'ui.title_art': false } });
    renderWithSilo(<Consumer />, { session: sessionOf() });
    expect(screen.getByTestId('consumer')).toHaveTextContent('true|unknown');
    await act(async () => {
      open();
      await Promise.resolve();
    });
    await shows('consumer', 'false|known');
  });

  it('shares one capability read and one value read between consumers', async () => {
    const calls = serveSettings(server);
    renderWithSilo(
      <>
        <Consumer name="a" />
        <Consumer name="b" />
        <AllValues />
      </>,
      { session: sessionOf() },
    );
    await shows('a', 'true|known');
    await shows('b', 'true|known');
    await shows('all', 'ui.title_art');
    expect(calls.capabilities).toHaveLength(1);
    expect(calls.effective).toHaveLength(1);
  });

  it('does not send a key the manifest revision does not cover', async () => {
    const calls = serveSettings(server, { manifestRevision: 16 });
    renderWithSilo(<AllValues />, { session: sessionOf() });
    await shows('all', 'ui.title_art');
    const asked = new URL(calls.effective[0]!.url).searchParams.getAll('keys');
    expect(asked).toEqual(keysKnownAt(16));
    expect(asked).toContain('ui.title_art');
    expect(asked).not.toContain('catalog.hide_unwatched_episode_images');
    expect(asked).toContain('playback.intro_skip_mode');
  });

  it('on a server older than revision 7 asks for the legacy intro key and derives the mode', async () => {
    const calls = serveSettings(server, {
      manifestRevision: 6,
      values: { 'playback.auto_skip_intro': true },
    });
    function Mode() {
      const { value, known } = useProfileSetting('playback.intro_skip_mode');
      return <div data-testid="mode">{known ? value : 'unknown'}</div>;
    }
    renderWithSilo(<Mode />, { session: sessionOf() });
    await shows('mode', 'always');
    const asked = new URL(calls.effective[0]!.url).searchParams.getAll('keys');
    expect(asked).toContain('playback.auto_skip_intro');
    expect(asked).not.toContain('playback.intro_skip_mode');
  });

  it('returns typed values: numbers, enums and objects, not only booleans', async () => {
    serveSettings(server, {
      values: {
        'playback.next_up_prompt_seconds': 60,
        'playback.intro_skip_mode': 'never',
        'playback.subtitle_appearance': { position: 'top' },
        'playback.auto_play_next': false,
      },
    });
    function Typed() {
      const seconds = useProfileSetting('playback.next_up_prompt_seconds').value;
      const mode = useProfileSetting('playback.intro_skip_mode').value;
      const look = useProfileSetting('playback.subtitle_appearance').value;
      const next = useProfileSetting('playback.auto_play_next').value;
      // Compile-time proof of the inference: a number, a literal union, an object, a boolean.
      const sum: number = seconds + 1;
      return (
        <div data-testid="typed">
          {sum}|{mode}|{look.position}|{look.fontSize}|{String(next)}
        </div>
      );
    }
    renderWithSilo(<Typed />, { session: sessionOf() });
    await shows('typed', '61|never|top|large|false');
  });

  it('keeps a bad server value out of the screens', async () => {
    serveSettings(server, {
      values: { 'playback.next_up_prompt_seconds': 999, 'ui.title_art': 'maybe' },
    });
    renderWithSilo(<AllValues />, { session: sessionOf() });
    await shows('all', '"playback.next_up_prompt_seconds":30');
    expect(screen.getByTestId('all')).toHaveTextContent('"ui.title_art":true');
  });

  it('on a server older than every key asks only for the legacy intro key', async () => {
    const calls = serveSettings(server, { manifestRevision: 0 });
    renderWithSilo(<Consumer />, { session: sessionOf() });
    await shows('consumer', 'true|known');
    expect(new URL(calls.effective[0]!.url).searchParams.getAll('keys')).toEqual([
      'playback.auto_skip_intro',
    ]);
  });

  it.each([
    ['not_configured', { state: 'not_configured' as const }],
    ['unsupported', { state: 'unsupported' as const }],
    ['not allowed', { allowed: false }],
  ])(
    'uses the defaults and reads no values when the capability is %s',
    async (_name, capabilities) => {
      const calls = serveSettings(server, { capabilities, values: { 'ui.title_art': false } });
      renderWithSilo(<Consumer />, { session: sessionOf() });
      await shows('consumer', 'true|known');
      expect(calls.effective).toHaveLength(0);
    },
  );

  it('uses the defaults when the capability read fails', async () => {
    const calls = serveSettings(server, { capabilities: 'fail' });
    renderWithSilo(<Consumer />, { session: sessionOf() });
    await shows('consumer', 'true|known');
    expect(calls.effective).toHaveLength(0);
  });

  it('uses the defaults when the value read fails', async () => {
    serveSettings(server, { effective: 'fail', values: { 'ui.title_art': false } });
    renderWithSilo(<Consumer />, { session: sessionOf() });
    await shows('consumer', 'true|known');
  });

  it('uses the defaults when the server refuses a key (422)', async () => {
    // The manifest claims revision 40 but does not know title art: the whole read is refused.
    serveSettings(server, {
      introducedIn: { 'ui.title_art': 99 },
      values: { 'ui.title_art': false },
    });
    renderWithSilo(<AllValues />, { session: sessionOf() });
    await shows('all', '"ui.title_art":true');
  });

  it('is known with the defaults, and asks nothing, while no profile is open', async () => {
    const calls = serveSettings(server);
    renderWithSilo(<Consumer />, { session: sessionOf(null) });
    await shows('consumer', 'true|known');
    expect(calls.capabilities).toHaveLength(0);
    expect(calls.effective).toHaveLength(0);
  });

  it('reads again for another profile', async () => {
    const calls = serveSettings(server);
    const session = sessionOf('p1');
    // The consumer sits under the component that re-renders, as a screen does after a switch.
    function SwitchProfile() {
      const [, render] = useState(0);
      return (
        <>
          <button
            onClick={() => {
              session.update({ profileId: 'p2' });
              render((n) => n + 1);
            }}
          >
            switch
          </button>
          <Consumer />
        </>
      );
    }
    renderWithSilo(<SwitchProfile />, { session });
    await shows('consumer', 'true|known');
    fireEvent.click(screen.getByText('switch'));
    await waitFor(() => expect(calls.effective).toHaveLength(2));
    expect(calls.effective[1]!.headers.get('X-Profile-Id')).toBe('p2');
    expect(calls.capabilities[1]!.headers.get('X-Profile-Id')).toBe('p2');
  });
});

describe('ProfileSettingsSync', () => {
  it('reads the values again when the page becomes visible', async () => {
    const calls = serveSettings(server);
    renderWithSilo(
      <>
        <ProfileSettingsSync />
        <Consumer />
      </>,
      { session: sessionOf() },
    );
    await shows('consumer', 'true|known');
    expect(calls.effective).toHaveLength(1);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(calls.effective).toHaveLength(2));
    // Hidden is not "back in the foreground".
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    expect(calls.effective).toHaveLength(2);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('reads the values again when the app is launched again', async () => {
    let relaunch: () => void = () => {};
    setPlatformForTests({
      ...getPlatform(),
      onRelaunch: (handler) => {
        relaunch = () => handler({});
        return () => {};
      },
    });
    const calls = serveSettings(server);
    renderWithSilo(
      <>
        <ProfileSettingsSync />
        <Consumer />
      </>,
      { session: sessionOf() },
    );
    await shows('consumer', 'true|known');
    act(() => relaunch());
    await waitFor(() => expect(calls.effective).toHaveLength(2));
  });
});

describe('useSetProfileSettingAt at the profile_device scope', () => {
  interface Put {
    key: string;
    scope: string | null;
    profile: string | null;
    body: unknown;
  }

  function serveWrite(puts: Put[], answer?: (value: unknown) => unknown) {
    server.use(
      http.put(`${BASE_URL}/api/v2/settings/values/:key`, async ({ request, params }) => {
        const body = (await request.json()) as { value: unknown };
        puts.push({
          key: String(params.key),
          scope: new URL(request.url).searchParams.get('scope'),
          profile: request.headers.get('X-Profile-Id'),
          body,
        });
        return HttpResponse.json({
          key: params.key,
          scope: 'profile_device',
          value: answer ? answer(body.value) : body.value,
          revision: 1,
        });
      }),
    );
  }

  function Toggle() {
    const { value } = useProfileSetting('playback.auto_play_next');
    const set = useSetProfileSettingAt('profile_device');
    return (
      <div>
        <div data-testid="next">{String(value)}</div>
        <button onClick={() => void set('playback.auto_play_next', !value)}>toggle</button>
      </div>
    );
  }

  it('writes one key at the profile_device scope and updates the shared values', async () => {
    serveSettings(server);
    const puts: Put[] = [];
    serveWrite(puts);
    renderWithSilo(
      <>
        <Toggle />
        <Consumer />
      </>,
      { session: sessionOf() },
    );
    await shows('next', 'true');
    await shows('consumer', 'true|known');
    fireEvent.click(screen.getByText('toggle'));
    await shows('next', 'false');
    expect(puts).toEqual([
      {
        key: 'playback.auto_play_next',
        scope: 'profile_device',
        profile: 'p1',
        body: { value: false },
      },
    ]);
  });

  it('follows the value the server stored, not the one that was sent', async () => {
    serveSettings(server);
    // The server answers true although the toggle sent false.
    serveWrite([], () => true);
    renderWithSilo(<Toggle />, { session: sessionOf() });
    await shows('next', 'true');
    fireEvent.click(screen.getByText('toggle'));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    expect(screen.getByTestId('next')).toHaveTextContent('true');
  });

  it('rejects and leaves the cache alone when the write fails', async () => {
    serveSettings(server);
    server.use(
      http.put(
        `${BASE_URL}/api/v2/settings/values/:key`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    let failure: unknown = null;
    function Failing() {
      const { value } = useProfileSetting('playback.auto_play_next');
      const set = useSetProfileSettingAt('profile_device');
      return (
        <div>
          <div data-testid="next">{String(value)}</div>
          <button onClick={() => set('playback.auto_play_next', false).catch((e) => (failure = e))}>
            go
          </button>
        </div>
      );
    }
    renderWithSilo(<Failing />, { session: sessionOf() });
    await shows('next', 'true');
    fireEvent.click(screen.getByText('go'));
    await waitFor(() => expect(failure).not.toBeNull());
    // Let a (wrong) cache update render before looking.
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    expect(screen.getByTestId('next')).toHaveTextContent('true');
  });

  /** `onWrite` hands the write's promise to a test that expects it to reject. */
  function Seconds({ onWrite }: { onWrite?: (write: Promise<void>) => void }) {
    const { value } = useProfileSetting('playback.next_up_prompt_seconds');
    const set = useSetProfileSettingAt('profile_device');
    return (
      <div>
        <div data-testid="seconds">{value}</div>
        <button
          onClick={() => {
            const write = set('playback.next_up_prompt_seconds', 45);
            if (onWrite) onWrite(write);
            else void write;
          }}
        >
          set
        </button>
      </div>
    );
  }

  it('keeps a seeded non-default value in the cache when the write fails', async () => {
    serveSettings(server, { values: { 'playback.next_up_prompt_seconds': 60 } });
    server.use(
      http.put(
        `${BASE_URL}/api/v2/settings/values/:key`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    let write: Promise<void> | undefined;
    renderWithSilo(<Seconds onWrite={(p) => (write = p)} />, { session: sessionOf() });
    await shows('seconds', '60');
    fireEvent.click(screen.getByText('set'));
    await expect(write).rejects.toThrow(/500/);
    // Let a (wrong) cache update render before looking.
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));
    expect(screen.getByTestId('seconds')).toHaveTextContent('60');
  });

  it('stores the value the server answered, not the one sent', async () => {
    serveSettings(server, { values: { 'playback.next_up_prompt_seconds': 60 } });
    serveWrite([], () => 30);
    renderWithSilo(<Seconds />, { session: sessionOf() });
    await shows('seconds', '60');
    fireEvent.click(screen.getByText('set'));
    await shows('seconds', '30');
  });

  it('keeps the sent value when the answered one is of the wrong type', async () => {
    serveSettings(server, { values: { 'playback.next_up_prompt_seconds': 60 } });
    serveWrite([], () => 'soon');
    renderWithSilo(<Seconds />, { session: sessionOf() });
    await shows('seconds', '60');
    fireEvent.click(screen.getByText('set'));
    await shows('seconds', '45');
  });
});

describe('useServerKnowsSetting', () => {
  function Knows({ name }: { name: 'playback.subtitle_appearance' | 'ui.title_art' }) {
    return <div data-testid="knows">{String(useServerKnowsSetting(name))}</div>;
  }

  it('is true once the manifest revision covers the key, and false below it', async () => {
    serveSettings(server, { manifestRevision: 1 });
    renderWithSilo(<Knows name="playback.subtitle_appearance" />, { session: sessionOf() });
    await shows('knows', 'true');
    cleanup();
    renderWithSilo(<Knows name="ui.title_art" />, { session: sessionOf() });
    // ui.title_art came with revision 16.
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    expect(screen.getByTestId('knows')).toHaveTextContent('false');
  });

  it('is false while unanswered, without a contract, and without a profile', async () => {
    serveSettings(server, { capabilities: { state: 'unsupported' } });
    renderWithSilo(<Knows name="playback.subtitle_appearance" />, { session: sessionOf() });
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    expect(screen.getByTestId('knows')).toHaveTextContent('false');
    cleanup();
    renderWithSilo(<Knows name="playback.subtitle_appearance" />, { session: sessionOf(null) });
    expect(screen.getByTestId('knows')).toHaveTextContent('false');
  });
});

describe('useResetProfileDeviceSetting', () => {
  interface Delete {
    key: string;
    scope: string | null;
    profile: string | null;
  }

  function Reset({ onDone }: { onDone?: (error: unknown) => void }) {
    const { value } = useProfileSetting('playback.next_up_prompt_seconds');
    const reset = useResetProfileDeviceSetting();
    return (
      <div>
        <div data-testid="seconds">{value}</div>
        <button
          onClick={() =>
            reset('playback.next_up_prompt_seconds').then(
              () => onDone?.(null),
              (error) => onDone?.(error),
            )
          }
        >
          reset
        </button>
      </div>
    );
  }

  it('deletes the profile_device value and reads the effective values again', async () => {
    const values: Record<string, unknown> = { 'playback.next_up_prompt_seconds': 60 };
    const calls = serveSettings(server, { values });
    const deletes: Delete[] = [];
    server.use(
      http.delete(`${BASE_URL}/api/v2/settings/values/:key`, ({ request, params }) => {
        deletes.push({
          key: String(params.key),
          scope: new URL(request.url).searchParams.get('scope'),
          profile: request.headers.get('X-Profile-Id'),
        });
        delete values[String(params.key)];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithSilo(<Reset />, { session: sessionOf() });
    await shows('seconds', '60');
    fireEvent.click(screen.getByText('reset'));
    // The default (30) is back once the answer of the second read is in.
    await shows('seconds', '30');
    expect(deletes).toEqual([
      { key: 'playback.next_up_prompt_seconds', scope: 'profile_device', profile: 'p1' },
    ]);
    expect(calls.effective).toHaveLength(2);
  });

  it('has the effective value in the cache when the reset resolves, even if the read is slow', async () => {
    const values: Record<string, unknown> = { 'playback.next_up_prompt_seconds': 60 };
    serveSettings(server, { values });
    server.use(
      http.delete(`${BASE_URL}/api/v2/settings/values/:key`, ({ params }) => {
        delete values[String(params.key)];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const seen: unknown[] = [];
    const client = newQueryClient();
    const onDone = () => {
      const [entry] = client.getQueriesData<Record<string, unknown>>({
        queryKey: ['settings', 'effective'],
      });
      seen.push(entry?.[1]?.['playback.next_up_prompt_seconds']);
    };
    renderWithSilo(<Reset onDone={onDone} />, { session: sessionOf(), queryClient: client });
    await shows('seconds', '60');
    // From now on the effective read takes a while.
    server.use(
      http.get(`${BASE_URL}/api/v2/settings/values/effective`, async ({ request }) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const keys = new URL(request.url).searchParams.getAll('keys');
        return HttpResponse.json({
          items: keys.map((key) => ({
            key,
            value: key === 'playback.next_up_prompt_seconds' ? 30 : undefined,
            source: 'default',
            definition_revision: 1,
          })),
          revision: 40,
        });
      }),
    );
    fireEvent.click(screen.getByText('reset'));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toBe(30);
  });

  it('rejects without a request when no profile is open', async () => {
    serveSettings(server);
    const sent: string[] = [];
    server.use(
      http.delete(`${BASE_URL}/api/v2/settings/values/:key`, ({ params }) => {
        sent.push(String(params.key));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const results: unknown[] = [];
    renderWithSilo(<Reset onDone={(error) => results.push(error)} />, {
      session: sessionOf(null),
    });
    fireEvent.click(screen.getByText('reset'));
    await waitFor(() => expect(results).toHaveLength(1));
    expect(results[0]).toBeInstanceOf(Error);
    expect((results[0] as Error).message).toBe('No profile is open');
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    expect(sent).toEqual([]);
  });

  it('counts a 404 as done and rejects on any other failure', async () => {
    serveSettings(server);
    let status = 404;
    server.use(
      http.delete(
        `${BASE_URL}/api/v2/settings/values/:key`,
        () => new HttpResponse(null, { status }),
      ),
    );
    const results: unknown[] = [];
    renderWithSilo(<Reset onDone={(error) => results.push(error)} />, { session: sessionOf() });
    await shows('seconds', '30');
    fireEvent.click(screen.getByText('reset'));
    await waitFor(() => expect(results).toEqual([null]));
    status = 500;
    fireEvent.click(screen.getByText('reset'));
    await waitFor(() => expect(results).toHaveLength(2));
    expect(results[1]).toBeInstanceOf(Error);
  });
});
