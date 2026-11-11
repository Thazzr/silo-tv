import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLanguageSetting, setLanguageSetting } from '../../i18n/languageSetting';
import { getResumeRewind, setResumeRewind } from '../../playback/resumeRewind';
import { getTimeMode, setTimeMode } from '../../playback/timeDisplay';
import { Session } from '../../api/session';
import { BASE_URL, account } from '../../test/apiFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { serveSettings } from '../../test/settingsFixtures';
import { PROFILE_SETTINGS, useProfileSettings, useServerKnowsSetting } from './profileSettings';
import { SettingsScreen } from './SettingsScreen';

beforeEach(() => {
  window.localStorage.clear();
  act(() => setLanguageSetting('auto'));
});

function setup() {
  const onBack = vi.fn();
  const view = renderWithSilo(<SettingsScreen onBack={onBack} />, { lang: undefined });
  return { onBack, ...view };
}

const pill = (name: string) => screen.getByRole('radio', { name });
const group = (id: string) => within(screen.getByTestId(id));

/** Walks from the first row (language) down to the rewind row; its selected pill takes the focus. */
async function toRewind() {
  await waitFor(() => expect(pill('Automatic (like the TV)')).toHaveFocus());
  await pressKey(KEY.down);
  await pressKey(KEY.down);
  await waitFor(() => expect(pill('7 s')).toHaveFocus());
}

describe('SettingsScreen sections', () => {
  it('shows the title, the device heading and its note', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'This TV' })).toBeInTheDocument();
    expect(screen.getByText('Applies to this TV only')).toBeInTheDocument();
  });

  it('puts the three rows in the device section: language, time display, rewind', () => {
    setup();
    const section = within(screen.getByTestId('settings-device'));
    const groups = section.getAllByRole('radiogroup');
    expect(groups.map((g) => g.getAttribute('data-testid'))).toEqual([
      'settings-language',
      'settings-time',
      'settings-rewind',
    ]);
    expect(groups.map((g) => g.getAttribute('aria-labelledby'))).toEqual([
      'settings-language-label',
      'settings-time-label',
      'settings-rewind-label',
    ]);
    expect(section.getByText('Language')).toBeInTheDocument();
    expect(section.getByText('Time display in the player')).toBeInTheDocument();
    expect(section.getByText('Rewind on resume')).toBeInTheDocument();
    // Everything on the screen is in that one section for now.
    expect(screen.getAllByRole('radiogroup')).toHaveLength(3);
  });

  it('keeps the section heading and note out of the focus order', () => {
    setup();
    const heading = screen.getByRole('heading', { level: 2, name: 'This TV' });
    expect(heading).not.toHaveAttribute('tabindex');
    expect(heading).not.toHaveAttribute('data-focus-key');
    const note = screen.getByText('Applies to this TV only');
    expect(note).not.toHaveAttribute('data-focus-key');
    // Every focusable on the screen is a pill.
    for (const el of document.querySelectorAll('[data-focus-key]')) {
      expect(el.getAttribute('role') ?? el.tagName).toMatch(/radio|BUTTON/);
    }
  });

  it('Down and Up walk the rows across the section in order, onto the selected pill of each', async () => {
    setup();
    await waitFor(() => expect(pill('Automatic (like the TV)')).toHaveFocus());
    await pressKey(KEY.down);
    await waitFor(() => expect(pill('Combined')).toHaveFocus());
    await pressKey(KEY.down);
    await waitFor(() => expect(pill('7 s')).toHaveFocus());
    await pressKey(KEY.up);
    await waitFor(() => expect(pill('Combined')).toHaveFocus());
    await pressKey(KEY.up);
    await waitFor(() => expect(pill('Automatic (like the TV)')).toHaveFocus());
  });

  it('Back leaves the screen', async () => {
    const { onBack } = setup();
    await waitFor(() => expect(pill('Automatic (like the TV)')).toHaveFocus());
    await pressKey(KEY.back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsScreen focus', () => {
  it('opens with the focus on the selected language pill, without a key press', async () => {
    setLanguageSetting('de');
    setup();
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Deutsch' })).toHaveFocus());
  });

  it('enters a row on its selected pill, not on the one highlighted last', async () => {
    setup();
    await waitFor(() => expect(pill('Automatic (like the TV)')).toHaveFocus());
    await pressKey(KEY.down);
    await waitFor(() => expect(pill('Combined')).toHaveFocus());
    // The highlight moves off the selected pill; nothing is selected.
    await pressKey(KEY.right);
    expect(pill('Position / length')).toHaveFocus();
    expect(pill('Combined')).toHaveClass('selected');
    await pressKey(KEY.down);
    await waitFor(() => expect(pill('7 s')).toHaveFocus());
    await pressKey(KEY.up);
    await waitFor(() => expect(pill('Combined')).toHaveFocus());
  });
});

describe('SettingsScreen in German', () => {
  it('labels the four time modes with four different texts', () => {
    setLanguageSetting('de');
    setup();
    expect(
      group('settings-time')
        .getAllByRole('radio')
        .map((p) => p.textContent),
    ).toEqual(['Kombiniert', 'Position/Länge', 'Restzeit', 'Endet um']);
  });
});

describe('SettingsScreen rewind row', () => {
  it('lists its pills', () => {
    setup();
    expect(
      group('settings-rewind')
        .getAllByRole('radio')
        .map((p) => p.textContent),
    ).toEqual(['Off', '5 s', '7 s', '10 s', '15 s', '20 s', '30 s']);
  });

  it('marks the selected pill (7 s by default) and focuses it when the row is entered', async () => {
    setup();
    await toRewind();
    expect(pill('7 s')).toHaveAttribute('aria-checked', 'true');
    expect(pill('7 s')).toHaveClass('selected');
    expect(pill('10 s')).toHaveAttribute('aria-checked', 'false');
  });

  it('enters on the stored value when it is a choice', async () => {
    setResumeRewind(20);
    setup();
    await waitFor(() => expect(pill('Automatic (like the TV)')).toHaveFocus());
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await waitFor(() => expect(pill('20 s')).toHaveFocus());
    expect(pill('20 s')).toHaveClass('selected');
  });

  it('marks no pill for a stored value that is not a choice, and still applies it', () => {
    setResumeRewind(12);
    setup();
    expect(group('settings-rewind').queryAllByRole('radio', { checked: true })).toHaveLength(0);
    expect(getResumeRewind()).toBe(12);
  });

  it('arrow keys alone move the highlight and never change the value', async () => {
    setup();
    await toRewind();
    await pressKey(KEY.right);
    expect(pill('10 s')).toHaveFocus();
    await pressKey(KEY.left);
    await pressKey(KEY.left);
    expect(pill('5 s')).toHaveFocus();
    expect(getResumeRewind()).toBe(7);
    expect(pill('7 s')).toHaveClass('selected');
    expect(pill('5 s')).not.toHaveClass('selected');
  });

  it('Right twice and OK from 7 s selects 15 s and stores it', async () => {
    setup();
    await toRewind();
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    expect(pill('15 s')).toHaveFocus();
    await pressKey(KEY.enter);
    expect(pill('15 s')).toHaveClass('selected');
    expect(pill('7 s')).not.toHaveClass('selected');
    expect(window.localStorage.getItem('silo-tv.settings.resumeRewindSeconds')).toBe('15');
    expect(getResumeRewind()).toBe(15);
  });

  it('Off stores 0', () => {
    setup();
    fireEvent.click(pill('Off'));
    expect(getResumeRewind()).toBe(0);
    expect(pill('Off')).toHaveClass('selected');
  });

  it('hover only moves the highlight; a click selects', async () => {
    setup();
    fireEvent.mouseEnter(pill('30 s'));
    await waitFor(() => expect(pill('30 s')).toHaveFocus());
    expect(getResumeRewind()).toBe(7);
    expect(pill('30 s')).not.toHaveClass('selected');
    fireEvent.click(pill('30 s'));
    expect(getResumeRewind()).toBe(30);
    expect(pill('30 s')).toHaveClass('selected');
  });
});

describe('SettingsScreen time display row', () => {
  it('offers the four modes, with Combined selected by default', () => {
    setup();
    expect(
      group('settings-time')
        .getAllByRole('radio')
        .map((p) => p.textContent),
    ).toEqual(['Combined', 'Position / length', 'Time left', 'End time']);
    expect(pill('Combined')).toHaveAttribute('aria-checked', 'true');
  });

  it('is operated by keyboard: Down to the row, Right to a mode, OK stores it', async () => {
    setup();
    await waitFor(() => expect(pill('Automatic (like the TV)')).toHaveFocus());
    await pressKey(KEY.down);
    await waitFor(() => expect(pill('Combined')).toHaveFocus());
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    expect(pill('Time left')).toHaveFocus();
    // Moving the highlight changes nothing.
    expect(getTimeMode()).toBe('combined');
    await pressKey(KEY.enter);
    expect(getTimeMode()).toBe('remaining');
    expect(pill('Time left')).toHaveClass('selected');
    expect(pill('Combined')).not.toHaveClass('selected');
    // The focus stays on the pill that was pressed.
    expect(pill('Time left')).toHaveFocus();
  });

  it('shows the stored mode as selected', () => {
    setTimeMode('endsAt');
    setup();
    expect(pill('End time')).toHaveAttribute('aria-checked', 'true');
  });
});

describe('SettingsScreen language row', () => {
  it('offers Automatic, Deutsch and English, each language in its own words', () => {
    setup();
    expect(
      group('settings-language')
        .getAllByRole('radio')
        .map((p) => p.textContent),
    ).toEqual(['Automatic (like the TV)', 'Deutsch', 'English']);
    expect(pill('Automatic (like the TV)')).toHaveAttribute('aria-checked', 'true');
  });

  it('is operated by keyboard: OK on Deutsch switches the whole screen at once, focus stays', async () => {
    setup();
    await waitFor(() => expect(pill('Automatic (like the TV)')).toHaveFocus());
    await pressKey(KEY.right);
    await waitFor(() => expect(pill('Deutsch')).toHaveFocus());
    await pressKey(KEY.enter);
    expect(getLanguageSetting()).toBe('de');
    expect(window.localStorage.getItem('silo-tv.settings.language')).toBe('de');
    // Visible texts are German now, and the option labels keep their own language.
    expect(screen.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Dieser Fernseher' })).toBeInTheDocument();
    expect(screen.getByText('Gilt nur für diesen TV')).toBeInTheDocument();
    expect(screen.getByText('Sprache')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Automatisch (wie Fernseher)' })).toBeInTheDocument();
    expect(pill('Deutsch')).toHaveClass('selected');
    expect(pill('English')).toBeInTheDocument();
    expect(pill('Deutsch')).toHaveFocus();
    // And back.
    await pressKey(KEY.right);
    await pressKey(KEY.enter);
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(pill('English')).toHaveFocus();
  });

  it('shows the stored language as selected', () => {
    setLanguageSetting('en');
    setup();
    expect(pill('English')).toHaveAttribute('aria-checked', 'true');
  });
});

describe('SettingsScreen subtitle appearance row', () => {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  function signedIn(): Session {
    const session = new Session(memoryStorage());
    session.set({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + 3600_000,
      user: account,
      profileId: 'p1',
    });
    return session;
  }

  function open() {
    renderWithSilo(<SettingsScreen onBack={() => undefined} />, {
      lang: undefined,
      session: signedIn(),
    });
  }

  it('shows when the server knows the key, with a summary of the current look', async () => {
    serveSettings(server, {
      values: { 'playback.subtitle_appearance': { fontSize: 'xlarge', fontColor: '#facc15' } },
    });
    open();
    const row = await screen.findByRole('button', { name: /Subtitle appearance/ });
    await waitFor(() => expect(row).toHaveTextContent('X-Large · Yellow · Box'));
    // It is a profile setting, so it sits in the profile's section, not in the TV's.
    expect(within(screen.getByTestId('settings-playback')).getByTestId('settings-subtitles')).toBe(
      row,
    );
    expect(
      within(screen.getByTestId('settings-device')).queryByTestId('settings-subtitles'),
    ).toBeNull();
  });

  it('summarizes the default look, and in German', async () => {
    serveSettings(server);
    setLanguageSetting('de');
    open();
    await waitFor(() =>
      expect(screen.getByTestId('settings-subtitles-summary')).toHaveTextContent(
        'Groß · Weiß · Box',
      ),
    );
    expect(screen.getByRole('button', { name: /Darstellung der Untertitel/ })).toBeInTheDocument();
  });

  it('is operated by keyboard: OK opens the dialog, Back closes it and the focus returns to the row', async () => {
    serveSettings(server);
    open();
    const row = await screen.findByTestId('settings-subtitles');
    // The language row has the focus (the profile section was not there when the screen opened);
    // the entry is right above it.
    await waitFor(() => expect(pill('Automatic (like the TV)')).toHaveFocus());
    await pressKey(KEY.up);
    expect(row).toHaveFocus();
    expect(screen.queryByTestId('subtitle-dialog')).toBeNull();
    await pressKey(KEY.enter);
    const dialog = await screen.findByTestId('subtitle-dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Subtitle appearance' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('subtitle-dialog-size')).toHaveFocus());
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('subtitle-dialog')).toBeNull());
    await waitFor(() => expect(row).toHaveFocus());
  });

  it('closes only the dialog on Back, not the screen under it', async () => {
    serveSettings(server);
    const onBack = vi.fn();
    renderWithSilo(<SettingsScreen onBack={onBack} />, { lang: undefined, session: signedIn() });
    fireEvent.click(await screen.findByTestId('settings-subtitles'));
    await screen.findByTestId('subtitle-dialog');
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('subtitle-dialog')).toBeNull());
    expect(onBack).not.toHaveBeenCalled();
    // The screen's own Back works again once the dialog is gone.
    await pressKey(KEY.back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('is hidden when the server is older than the key', async () => {
    serveSettings(server, { manifestRevision: 0 });
    open();
    await waitFor(() => expect(screen.getByTestId('settings-device')).toBeInTheDocument());
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));
    expect(screen.queryByTestId('settings-subtitles')).toBeNull();
  });

  /** Runs `body` with the manifest revision that introduced `key` set to `revision`. */
  async function introducedAt(
    key: 'playback.subtitle_appearance' | 'playback.auto_play_next',
    revision: number,
    body: () => Promise<void>,
  ) {
    const def = PROFILE_SETTINGS[key] as { introducedIn: number };
    const before = def.introducedIn;
    def.introducedIn = revision;
    try {
      await body();
    } finally {
      def.introducedIn = before;
    }
  }

  it('is hidden when the server knows auto-play next but not the subtitle appearance', async () => {
    await introducedAt('playback.subtitle_appearance', 30, async () => {
      serveSettings(server, { manifestRevision: 10 });
      open();
      await screen.findByTestId('settings-autoplay');
      await act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));
      expect(screen.getByTestId('settings-playback')).toBeInTheDocument();
      expect(screen.queryByTestId('settings-subtitles')).toBeNull();
    });
  });

  it('still shows the Playback section for a server that knows only the subtitle appearance, and the entry has the focus', async () => {
    await introducedAt('playback.auto_play_next', 30, async () => {
      serveSettings(server, { manifestRevision: 10 });
      // The screen mounts once the profile's settings are read, as when it opens from Home.
      function AfterSettings() {
        const knows = useServerKnowsSetting('playback.subtitle_appearance');
        const { known } = useProfileSettings();
        return knows && known ? <SettingsScreen onBack={() => undefined} /> : null;
      }
      renderWithSilo(<AfterSettings />, { lang: undefined, session: signedIn() });
      const entry = await screen.findByTestId('settings-subtitles');
      expect(
        within(screen.getByTestId('settings-playback')).getByTestId('settings-subtitles'),
      ).toBe(entry);
      expect(screen.queryByTestId('settings-autoplay')).toBeNull();
      await waitFor(() => expect(entry).toHaveFocus());
    });
  });

  it('is hidden when the capabilities fail or the server has no contract', async () => {
    serveSettings(server, { capabilities: 'fail' });
    open();
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));
    expect(screen.queryByTestId('settings-subtitles')).toBeNull();
  });

  it('is hidden without a profile (nothing is asked)', () => {
    setup();
    expect(screen.queryByTestId('settings-subtitles')).toBeNull();
  });
});

describe('SettingsScreen playback section (auto-play next)', () => {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  const puts: { key: string; scope: string | null; value: unknown }[] = [];
  const deletes: { key: string; scope: string | null }[] = [];
  let putStatus = 200;
  beforeEach(() => {
    puts.length = 0;
    deletes.length = 0;
    putStatus = 200;
    server.use(
      http.put(`${BASE_URL}/api/v2/settings/values/:key`, async ({ request, params }) => {
        const body = (await request.json()) as { value: unknown };
        puts.push({
          key: String(params.key),
          scope: new URL(request.url).searchParams.get('scope'),
          value: body.value,
        });
        if (putStatus !== 200) return new HttpResponse(null, { status: putStatus });
        return HttpResponse.json({
          key: params.key,
          scope: 'profile',
          value: body.value,
          revision: 1,
        });
      }),
      http.delete(`${BASE_URL}/api/v2/settings/values/:key`, ({ request, params }) => {
        deletes.push({
          key: String(params.key),
          scope: new URL(request.url).searchParams.get('scope'),
        });
        return new HttpResponse(null, { status: 204 });
      }),
    );
  });

  const signedIn = () => {
    const session = new Session(memoryStorage());
    session.set({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + 3600_000,
      user: account,
      profileId: 'p1',
    });
    return session;
  };

  function open() {
    renderWithSilo(<SettingsScreen onBack={() => undefined} />, {
      lang: undefined,
      session: signedIn(),
    });
  }

  it('is a "Playback" section above "This TV", with a note that it is for the profile', async () => {
    serveSettings(server);
    open();
    const section = await screen.findByTestId('settings-playback');
    expect(
      within(section).getByRole('heading', { level: 2, name: 'Playback' }),
    ).toBeInTheDocument();
    expect(within(section).getByText('Applies to your profile on all devices')).toBeInTheDocument();
    expect(
      section.compareDocumentPosition(screen.getByTestId('settings-device')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(section).getByText('Auto-play next episode')).toBeInTheDocument();
  });

  it('reads the effective value: On by default', async () => {
    serveSettings(server);
    open();
    const row = await screen.findByTestId('settings-autoplay');
    expect(within(row).getByRole('radio', { name: 'On' })).toHaveAttribute('aria-checked', 'true');
    expect(within(row).getByRole('radio', { name: 'Off' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('shows Off when the effective value is false', async () => {
    serveSettings(server, { values: { 'playback.auto_play_next': false } });
    open();
    const row = await screen.findByTestId('settings-autoplay');
    await waitFor(() =>
      expect(within(row).getByRole('radio', { name: 'Off' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
  });

  it("writes the key at the profile scope on a click, then drops this TV's own value", async () => {
    serveSettings(server);
    open();
    const row = await screen.findByTestId('settings-autoplay');
    fireEvent.click(within(row).getByRole('radio', { name: 'Off' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ key: 'playback.auto_play_next', scope: 'profile', value: false });
    // The device row would outrank the profile's: it goes, as in the web app.
    await waitFor(() => expect(deletes).toHaveLength(1));
    expect(deletes[0]).toEqual({ key: 'playback.auto_play_next', scope: 'profile_device' });
    await waitFor(() =>
      expect(within(row).getByRole('radio', { name: 'Off' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
  });

  it("opens on the row's selected pill when the server's capability is already known", async () => {
    serveSettings(server, { values: { 'playback.auto_play_next': false } });
    // The screen mounts once the profile's settings are read, as when it opens from Home.
    function AfterSettings() {
      const knows = useServerKnowsSetting('playback.auto_play_next');
      const { known } = useProfileSettings();
      return knows && known ? <SettingsScreen onBack={() => undefined} /> : null;
    }
    renderWithSilo(<AfterSettings />, { lang: undefined, session: signedIn() });
    const row = within(await screen.findByTestId('settings-autoplay'));
    await waitFor(() => expect(row.getByRole('radio', { name: 'Off' })).toHaveFocus());
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));
    expect(row.getByRole('radio', { name: 'Off' })).toHaveFocus();
    expect(pill('Automatic (like the TV)')).not.toHaveFocus();
  });

  it('keeps the focus on the language row when the capability arrives after the screen opened', async () => {
    serveSettings(server);
    open();
    await waitFor(() => expect(pill('Automatic (like the TV)')).toHaveFocus());
    await screen.findByTestId('settings-autoplay');
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 150)));
    expect(pill('Automatic (like the TV)')).toHaveFocus();
    expect(
      within(screen.getByTestId('settings-autoplay')).getByRole('radio', { name: 'On' }),
    ).not.toHaveFocus();
  });

  it('is operated by keyboard: OK on a focused pill saves it', async () => {
    serveSettings(server);
    open();
    await screen.findByTestId('settings-autoplay');
    // The language row has the focus (the section was not there when the screen opened): Up
    // passes the subtitle appearance entry and enters the playback row on its selected pill, Right
    // moves to Off, OK saves.
    await waitFor(() => expect(pill('Automatic (like the TV)')).toHaveFocus());
    await pressKey(KEY.up);
    await pressKey(KEY.up);
    await waitFor(() => expect(pill('On')).toHaveFocus());
    await pressKey(KEY.right);
    await pressKey(KEY.enter);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.value).toBe(false);
  });

  it('keeps the shown value when the write fails', async () => {
    serveSettings(server);
    putStatus = 500;
    open();
    const row = await screen.findByTestId('settings-autoplay');
    fireEvent.click(within(row).getByRole('radio', { name: 'Off' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));
    expect(within(row).getByRole('radio', { name: 'On' })).toHaveAttribute('aria-checked', 'true');
    expect(deletes).toHaveLength(0);
  });

  it('is hidden when the server is older than the key, or has no contract', async () => {
    serveSettings(server, { manifestRevision: 0 });
    open();
    await waitFor(() => expect(screen.getByTestId('settings-device')).toBeInTheDocument());
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));
    expect(screen.queryByTestId('settings-playback')).toBeNull();
    expect(screen.queryByTestId('settings-autoplay')).toBeNull();
  });

  it('is hidden without a profile (nothing is asked)', () => {
    setup();
    expect(screen.queryByTestId('settings-playback')).toBeNull();
  });
});
