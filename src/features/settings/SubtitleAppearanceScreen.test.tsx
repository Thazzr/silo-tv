import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Navigator, useNavigator } from '../../app/nav';
import { SiloProvider } from '../../app/SiloContext';
import { Session } from '../../api/session';
import { I18nProvider } from '../../i18n';
import { account, BASE_URL } from '../../test/apiFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, newQueryClient, renderWithSilo, testDevice } from '../../test/renderFlow';
import { serveSettings } from '../../test/settingsFixtures';
import { DEFAULT_SUBTITLE_APPEARANCE, type SubtitleAppearance } from './profileSettings';
import {
  RETRY_DELAYS_MS,
  SAVE_DELAY_MS,
  SubtitleAppearanceScreen,
} from './SubtitleAppearanceScreen';
import { SettingsScreen } from './SettingsScreen';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(async () => {
  // Leaving a page sends its pending write; let it reach this test's handlers, not the next one's.
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 100));
  server.resetHandlers();
});
afterAll(() => server.close());

const STORED_KEY = 'playback.subtitle_appearance';

function sessionOf(): Session {
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

interface Write {
  method: 'PUT' | 'DELETE';
  key: string;
  scope: string | null;
  profile: string | null;
  value?: unknown;
}

/** A status, or 'network' for a request that never gets an answer. */
type PutAnswer = number | 'network';

interface Serve {
  /** The stored values of the profile; a DELETE removes the subtitle key from it. */
  values?: Record<string, unknown>;
  /** The status the PUT answers with. */
  put?: PutAnswer | (() => PutAnswer);
  /** The PUT is answered only once this has settled (it is recorded when it arrives). */
  putGate?: Promise<void>;
  /** The status the DELETE answers with (a real removal happens for 204 only). */
  del?: number;
  /** The DELETE is answered only once this has settled (it is recorded when it arrives). */
  delGate?: Promise<void>;
}

/** The settings reads plus a PUT and a DELETE that record what they were sent. */
function serve(options: Serve = {}) {
  const writes: Write[] = [];
  const values = options.values ?? {};
  serveSettings(server, { values });
  server.use(
    http.put(`${BASE_URL}/api/v2/settings/values/:key`, async ({ request, params }) => {
      const body = (await request.json()) as { value: unknown };
      writes.push({
        method: 'PUT',
        key: String(params.key),
        scope: new URL(request.url).searchParams.get('scope'),
        profile: request.headers.get('X-Profile-Id'),
        value: body.value,
      });
      await options.putGate;
      const status = typeof options.put === 'function' ? options.put() : (options.put ?? 200);
      if (status === 'network') return HttpResponse.error();
      if (status !== 200) return new HttpResponse(null, { status });
      values[String(params.key)] = body.value;
      return HttpResponse.json({
        key: params.key,
        scope: 'profile_device',
        value: body.value,
        revision: 1,
      });
    }),
    http.delete(`${BASE_URL}/api/v2/settings/values/:key`, async ({ request, params }) => {
      writes.push({
        method: 'DELETE',
        key: String(params.key),
        scope: new URL(request.url).searchParams.get('scope'),
        profile: request.headers.get('X-Profile-Id'),
      });
      await options.delGate;
      const status = options.del ?? 204;
      if (status === 204) delete values[String(params.key)];
      return new HttpResponse(null, { status });
    }),
  );
  return { writes, values };
}

const look = (over: Partial<SubtitleAppearance> = {}): SubtitleAppearance => ({
  ...DEFAULT_SUBTITLE_APPEARANCE,
  ...over,
});

const row = (id: string) => screen.getByTestId(`subtitle-row-${id}`);
const valueOf = (id: string) => screen.getByTestId(`subtitle-row-${id}-value`).textContent;
const previewLine = () =>
  within(screen.getByTestId('subtitle-preview')).getByText('This is how your subtitles look.');

/** Renders the page on its own and waits for its first row to take the focus. */
async function open() {
  const view = renderWithSilo(<SubtitleAppearanceScreen onBack={() => undefined} />, {
    session: sessionOf(),
  });
  await waitFor(() => expect(row('size')).toHaveFocus());
  return view;
}

const pause = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
/** Long enough for the debounce to have fired and its write to have gone out. */
const settle = () => pause(SAVE_DELAY_MS + 300);

describe('SubtitleAppearanceScreen rows', () => {
  it('shows the effective values, one row each, without the outline colour while the outline is off', async () => {
    serve();
    await open();
    expect(
      screen
        .getAllByTestId(/^subtitle-row-[a-zA-Z]+$/)
        .map((el) => el.getAttribute('data-testid')?.replace('subtitle-row-', '')),
    ).toEqual([
      'size',
      'font',
      'fontColor',
      'textOpacity',
      'background',
      'backgroundColor',
      'backgroundOpacity',
      'outline',
      'position',
    ]);
    expect(valueOf('size')).toBe('Large');
    expect(valueOf('font')).toBe('Standard');
    expect(valueOf('fontColor')).toBe('White');
    expect(valueOf('textOpacity')).toBe('100 %');
    expect(valueOf('background')).toBe('Box');
    expect(valueOf('backgroundColor')).toBe('Black');
    expect(valueOf('backgroundOpacity')).toBe('75 %');
    expect(valueOf('outline')).toBe('Off');
    expect(valueOf('position')).toBe('Bottom');
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
  });

  it('starts from the effective value of the profile', async () => {
    serve({ values: { [STORED_KEY]: look({ fontSize: 'xxlarge', backgroundStyle: 'shadow' }) } });
    await open();
    expect(valueOf('size')).toBe('Huge');
    expect(valueOf('background')).toBe('Shadow');
  });

  it('Right and Left step through the values and wrap around at both ends', async () => {
    serve();
    await open();
    // large -> xlarge -> xxlarge -> small (wrap)
    await pressKey(KEY.right);
    expect(valueOf('size')).toBe('Extra large');
    await pressKey(KEY.right);
    expect(valueOf('size')).toBe('Huge');
    await pressKey(KEY.right);
    expect(valueOf('size')).toBe('Small');
    // Left from the first wraps to the last.
    await pressKey(KEY.left);
    expect(valueOf('size')).toBe('Huge');
    await pressKey(KEY.left);
    expect(valueOf('size')).toBe('Extra large');
  });

  it('wraps colours, percentages, the outline switch and the position too', async () => {
    serve();
    await open();
    await pressKey(KEY.down); // font
    await pressKey(KEY.right);
    expect(valueOf('font')).toBe('Serif');
    await pressKey(KEY.right);
    expect(valueOf('font')).toBe('Typewriter');
    await pressKey(KEY.right);
    expect(valueOf('font')).toBe('Standard');
    await pressKey(KEY.down); // font colour: white is the first of nine
    await pressKey(KEY.left);
    expect(valueOf('fontColor')).toBe('Gray');
    await pressKey(KEY.right);
    expect(valueOf('fontColor')).toBe('White');
    await pressKey(KEY.down); // text opacity 100 -> 25
    await pressKey(KEY.right);
    expect(valueOf('textOpacity')).toBe('25 %');
    await pressKey(KEY.left);
    expect(valueOf('textOpacity')).toBe('100 %');
    await pressKey(KEY.down); // background: box ... none
    await pressKey(KEY.left);
    expect(valueOf('background')).toBe('None');
    await pressKey(KEY.down); // background colour
    await pressKey(KEY.down); // background opacity 75 -> 100 -> 0
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    expect(valueOf('backgroundOpacity')).toBe('0 %');
    await pressKey(KEY.down); // outline off -> on -> off
    await pressKey(KEY.right);
    expect(valueOf('outline')).toBe('On');
    await pressKey(KEY.right);
    expect(valueOf('outline')).toBe('Off');
    await pressKey(KEY.down); // position
    await pressKey(KEY.left);
    expect(valueOf('position')).toBe('Top');
    await pressKey(KEY.right);
    expect(valueOf('position')).toBe('Bottom');
  });

  it('OK does what Right does', async () => {
    serve();
    await open();
    await pressKey(KEY.enter);
    expect(valueOf('size')).toBe('Extra large');
    await pressKey(KEY.enter);
    expect(valueOf('size')).toBe('Huge');
  });

  it('Down and Up walk the rows, and stop at the first row and at Reset', async () => {
    serve();
    await open();
    await pressKey(KEY.up);
    expect(row('size')).toHaveFocus();
    const order = [
      'font',
      'fontColor',
      'textOpacity',
      'background',
      'backgroundColor',
      'backgroundOpacity',
      'outline',
      'position',
    ];
    for (const id of order) {
      await pressKey(KEY.down);
      expect(row(id)).toHaveFocus();
    }
    await pressKey(KEY.down);
    expect(screen.getByRole('button', { name: 'Reset' })).toHaveFocus();
    await pressKey(KEY.down);
    expect(screen.getByRole('button', { name: 'Reset' })).toHaveFocus();
    await pressKey(KEY.up);
    expect(row('position')).toHaveFocus();
  });

  it('shows the outline colour row only while the text outline is on', async () => {
    serve();
    await open();
    for (let i = 0; i < 7; i += 1) await pressKey(KEY.down);
    expect(row('outline')).toHaveFocus();
    expect(screen.queryByTestId('subtitle-row-outlineColor')).toBeNull();
    await pressKey(KEY.right);
    expect(valueOf('outlineColor')).toBe('Black');
    // It sits between the outline row and the position row.
    await pressKey(KEY.down);
    expect(row('outlineColor')).toHaveFocus();
    await pressKey(KEY.down);
    expect(row('position')).toHaveFocus();
    await pressKey(KEY.up);
    await pressKey(KEY.up);
    await pressKey(KEY.right);
    expect(screen.queryByTestId('subtitle-row-outlineColor')).toBeNull();
  });

  it('shows a skeleton of the rows until the settings are known', async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    serveSettings(server, { gate });
    renderWithSilo(<SubtitleAppearanceScreen onBack={() => undefined} />, { session: sessionOf() });
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    expect(screen.getByTestId('subtitle-preview')).toBeInTheDocument();
    open();
    await waitFor(() => expect(row('size')).toBeInTheDocument());
    expect(screen.queryByTestId('loading')).toBeNull();
  });

  it('is in German for a German TV', async () => {
    serve();
    renderWithSilo(<SubtitleAppearanceScreen onBack={() => undefined} />, {
      session: sessionOf(),
      lang: 'de',
    });
    await waitFor(() => expect(row('size')).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1, name: 'Untertitel-Aussehen' })).toBeVisible();
    expect(valueOf('size')).toBe('Groß');
    expect(valueOf('background')).toBe('Kasten');
    expect(screen.getByRole('button', { name: 'Zurücksetzen' })).toBeInTheDocument();
    expect(screen.getByText('So sehen deine Untertitel aus.')).toBeInTheDocument();
  });
});

describe('SubtitleAppearanceScreen preview', () => {
  it('draws the sample lines in the look of the profile, scaled to the frame', async () => {
    serve();
    await open();
    expect(screen.getByText('And this is a second line.')).toBeInTheDocument();
    // Large is 52 px at 1080p; the 540 px high frame is half of it.
    expect(previewLine().style.fontSize).toBe('26px');
    expect(previewLine().style.color).toBe('rgb(255, 255, 255)');
    expect(screen.getByTestId('subtitle-preview-block').style.bottom).toBe('27px');
  });

  it('follows every change at once, before anything is written', async () => {
    const { writes } = serve();
    await open();
    await pressKey(KEY.right);
    expect(previewLine().style.fontSize).toBe('31px');
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    expect(previewLine().style.color).toBe('rgb(255, 255, 0)');
    for (let i = 0; i < 6; i += 1) await pressKey(KEY.down);
    await pressKey(KEY.left);
    expect(screen.getByTestId('subtitle-preview-block').style.top).toBe('27px');
    expect(writes).toEqual([]);
  });
});

describe('SubtitleAppearanceScreen saving', () => {
  it('writes the complete appearance once for a burst of presses, at profile_device', async () => {
    const { writes } = serve();
    await open();
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    expect(writes).toEqual([]);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      method: 'PUT',
      key: STORED_KEY,
      scope: 'profile_device',
      profile: 'p1',
      value: look({ fontSize: 'small' }),
    });
    // Nothing follows.
    await settle();
    expect(writes).toHaveLength(1);
  });

  it('writes again after a later change, with every field', async () => {
    const { writes } = serve();
    await open();
    await pressKey(KEY.right);
    await waitFor(() => expect(writes).toHaveLength(1));
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    await waitFor(() => expect(writes).toHaveLength(2));
    const second = writes[1]!.value as SubtitleAppearance;
    expect(Object.keys(second).sort()).toEqual(Object.keys(DEFAULT_SUBTITLE_APPEARANCE).sort());
    expect(second).toEqual(look({ fontSize: 'xlarge', fontFamily: 'serif' }));
  });

  it('sends a write that is still waiting when the page is left', async () => {
    const { writes } = serve();
    const view = await open();
    await pressKey(KEY.right);
    expect(writes).toEqual([]);
    view.unmount();
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.value).toEqual(look({ fontSize: 'xlarge' }));
    // The timer is gone: nothing is sent a second time.
    await settle();
    expect(writes).toHaveLength(1);
  });

  it('writes nothing while nothing changed', async () => {
    const { writes } = serve();
    const view = await open();
    await settle();
    view.unmount();
    await pause(50);
    expect(writes).toEqual([]);
  });

  it('shows an error line under the preview when the write fails, keeps the values, and tries again on the next change', async () => {
    let status = 500;
    const { writes } = serve({ put: () => status });
    await open();
    expect(screen.queryByTestId('subtitle-save-error')).toBeNull();
    await pressKey(KEY.right);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not be saved'));
    expect(valueOf('size')).toBe('Extra large');
    expect(previewLine().style.fontSize).toBe('31px');
    status = 200;
    await pressKey(KEY.right);
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]!.value).toEqual(look({ fontSize: 'xxlarge' }));
    await waitFor(() => expect(screen.queryByTestId('subtitle-save-error')).toBeNull());
    expect(valueOf('size')).toBe('Huge');
  });
});

describe('SubtitleAppearanceScreen reset', () => {
  async function toReset() {
    for (let i = 0; i < 9; i += 1) await pressKey(KEY.down);
    expect(screen.getByRole('button', { name: 'Reset' })).toHaveFocus();
  }

  it('deletes the device value and shows the effective value again', async () => {
    const { writes } = serve({ values: { [STORED_KEY]: look({ fontSize: 'xxlarge' }) } });
    await open();
    expect(valueOf('size')).toBe('Huge');
    await pressKey(KEY.right);
    expect(valueOf('size')).toBe('Small');
    await toReset();
    await pressKey(KEY.enter);
    // The server's value is the default again once the device value is gone.
    await waitFor(() => expect(valueOf('size')).toBe('Large'));
    expect(writes).toEqual([
      { method: 'DELETE', key: STORED_KEY, scope: 'profile_device', profile: 'p1' },
    ]);
    expect(previewLine().style.fontSize).toBe('26px');
    // The reset was the last write: the earlier press was dropped, and nothing follows.
    await settle();
    expect(writes).toHaveLength(1);
  });

  it('counts a 404 (there was no device value) as done', async () => {
    serve({ del: 404, values: { [STORED_KEY]: look({ fontSize: 'small' }) } });
    await open();
    await pressKey(KEY.right);
    expect(valueOf('size')).toBe('Medium');
    await toReset();
    await pressKey(KEY.enter);
    await waitFor(() => expect(valueOf('size')).toBe('Small'));
    expect(screen.queryByTestId('subtitle-save-error')).toBeNull();
  });

  it('shows the error line when the delete fails and keeps what is shown', async () => {
    serve({ del: 500 });
    await open();
    await pressKey(KEY.right);
    await toReset();
    await pressKey(KEY.enter);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not be saved'));
    expect(valueOf('size')).toBe('Extra large');
  });
});

describe('SubtitleAppearanceScreen values from other clients', () => {
  it('shows a colour outside the palette as its hex value, and keeps it until changed', async () => {
    const { writes } = serve({ values: { [STORED_KEY]: look({ fontColor: '#123456' }) } });
    await open();
    expect(valueOf('fontColor')).toBe('#123456');
    // Another row's change writes it back unchanged.
    await pressKey(KEY.right);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect((writes[0]!.value as SubtitleAppearance).fontColor).toBe('#123456');
    // Right goes to the first palette colour, Left to the last.
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    expect(valueOf('fontColor')).toBe('White');
    await pressKey(KEY.left);
    expect(valueOf('fontColor')).toBe('Gray');
  });

  it('steps from a colour outside the palette back to the last palette colour', async () => {
    serve({ values: { [STORED_KEY]: look({ fontColor: '#123456' }) } });
    await open();
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.left);
    expect(valueOf('fontColor')).toBe('Gray');
  });

  it('shows an opacity outside the steps as its percentage and steps to the first or last', async () => {
    serve({ values: { [STORED_KEY]: look({ textOpacity: 60 }) } });
    await open();
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    expect(valueOf('textOpacity')).toBe('60 %');
    await pressKey(KEY.right);
    expect(valueOf('textOpacity')).toBe('25 %');
    await pressKey(KEY.left);
    expect(valueOf('textOpacity')).toBe('100 %');
  });

  it('shows a font family it does not offer by name and writes it back until it is changed', async () => {
    const { writes } = serve({ values: { [STORED_KEY]: look({ fontFamily: 'Roboto' }) } });
    await open();
    await pressKey(KEY.down);
    expect(valueOf('font')).toBe('Roboto');
    expect(previewLine().style.fontFamily).toContain('Roboto');
    await pressKey(KEY.up);
    await pressKey(KEY.right);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect((writes[0]!.value as SubtitleAppearance).fontFamily).toBe('Roboto');
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    expect(valueOf('font')).toBe('Standard');
    await waitFor(() => expect(writes).toHaveLength(2));
    expect((writes[1]!.value as SubtitleAppearance).fontFamily).toBe('sans-serif');
  });
});

describe('SubtitleAppearanceScreen in the screen stack', () => {
  type Route = 'settings' | 'subtitles';

  function Routes() {
    const nav = useNavigator<{ name: Route }>();
    return nav.current.name === 'settings' ? (
      <SettingsScreen
        onBack={nav.pop}
        onOpenSubtitleAppearance={() => nav.push({ name: 'subtitles' })}
      />
    ) : (
      <SubtitleAppearanceScreen onBack={nav.pop} />
    );
  }

  it('Back returns to the settings screen with the focus on the row that opened it', async () => {
    serve();
    render(
      <QueryClientProvider client={newQueryClient()}>
        <I18nProvider lang="en">
          <SiloProvider baseUrl={BASE_URL} session={sessionOf()} device={testDevice}>
            <Navigator initial={{ name: 'settings' as Route }} renderScreen={() => <Routes />} />
          </SiloProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );
    const opener = await screen.findByTestId('settings-subtitles');
    expect(opener).toHaveTextContent('Subtitle appearance');
    // The language row has the focus first; Down three times reaches the subtitle row.
    await waitFor(() => expect(screen.getByRole('radio', { name: /Automatic/ })).toHaveFocus());
    for (let i = 0; i < 3; i += 1) await pressKey(KEY.down);
    expect(opener).toHaveFocus();
    await pressKey(KEY.enter);
    await waitFor(() => expect(row('size')).toHaveFocus());
    await pressKey(KEY.right);
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.getByTestId('settings-screen')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('settings-subtitles')).toHaveFocus());
    // The change was written on the way out and the summary of the row follows it.
    await waitFor(() =>
      expect(screen.getByTestId('settings-subtitles-summary')).toHaveTextContent(
        'Extra large · White · Box',
      ),
    );
  });
});

/** The palette in its order, as the preview draws it: name and the colour it comes out as. */
const PALETTE: readonly (readonly [string, string])[] = [
  ['White', '255, 255, 255'],
  ['Yellow', '255, 255, 0'],
  ['Cyan', '0, 255, 255'],
  ['Green', '0, 255, 0'],
  ['Magenta', '255, 0, 255'],
  ['Red', '255, 0, 0'],
  ['Blue', '0, 0, 255'],
  ['Black', '0, 0, 0'],
  ['Gray', '128, 128, 128'],
];

async function down(times: number) {
  for (let i = 0; i < times; i += 1) await pressKey(KEY.down);
}

describe('SubtitleAppearanceScreen full cycles', () => {
  it('steps the font colour through the whole palette, each name drawing its own colour', async () => {
    serve();
    await open();
    await down(2);
    expect(row('fontColor')).toHaveFocus();
    for (let i = 1; i <= PALETTE.length; i += 1) {
      await pressKey(KEY.right);
      const [name, colour] = PALETTE[i % PALETTE.length]!;
      expect(valueOf('fontColor')).toBe(name);
      expect(previewLine().style.color).toBe(`rgb(${colour})`);
    }
  });

  it('steps the background colour through the whole palette, each name drawing its own colour', async () => {
    serve();
    await open();
    await down(5);
    expect(row('backgroundColor')).toHaveFocus();
    // It starts on black, the eighth of nine.
    for (let i = 8; i < 8 + PALETTE.length; i += 1) {
      await pressKey(KEY.right);
      const [name, colour] = PALETTE[i % PALETTE.length]!;
      expect(valueOf('backgroundColor')).toBe(name);
      expect(previewLine().style.backgroundColor).toBe(`rgba(${colour}, 0.75)`);
    }
  });

  it('steps the outline colour through the whole palette, each name drawing its own colour', async () => {
    serve();
    await open();
    await down(7);
    await pressKey(KEY.right);
    await pressKey(KEY.down);
    expect(row('outlineColor')).toHaveFocus();
    for (let i = 8; i < 8 + PALETTE.length; i += 1) {
      await pressKey(KEY.right);
      const [name, colour] = PALETTE[i % PALETTE.length]!;
      expect(valueOf('outlineColor')).toBe(name);
      expect(previewLine().style.textShadow).toContain(`rgb(${colour}) 1px 1px`);
    }
  });

  it('steps the background style through its four looks', async () => {
    serve();
    await open();
    await down(4);
    expect(row('background')).toHaveFocus();
    const shadow = () => previewLine().style.textShadow;
    expect(valueOf('background')).toBe('Box');
    expect(previewLine().style.backgroundColor).toBe('rgba(0, 0, 0, 0.75)');
    await pressKey(KEY.right);
    expect(valueOf('background')).toBe('Shadow');
    expect(previewLine().style.backgroundColor).toBe('transparent');
    expect(shadow()).toContain('4px');
    expect(shadow().match(/rgba\(0, 0, 0, 0\.75\)/g)).toHaveLength(2);
    await pressKey(KEY.right);
    expect(valueOf('background')).toBe('Outline');
    expect(previewLine().style.backgroundColor).toBe('transparent');
    expect(shadow().match(/rgba\(0, 0, 0, 0\.75\)/g)).toHaveLength(8);
    await pressKey(KEY.right);
    expect(valueOf('background')).toBe('None');
    expect(previewLine().style.backgroundColor).toBe('transparent');
    expect(shadow()).not.toContain('rgba');
    await pressKey(KEY.right);
    expect(valueOf('background')).toBe('Box');
  });

  it('steps the text opacity through 25, 50, 75 and 100 %, drawn as such', async () => {
    serve();
    await open();
    await down(3);
    expect(row('textOpacity')).toHaveFocus();
    for (const [text, alpha] of [
      ['25 %', '0.25'],
      ['50 %', '0.5'],
      ['75 %', '0.75'],
    ] as const) {
      await pressKey(KEY.right);
      expect(valueOf('textOpacity')).toBe(text);
      expect(previewLine().style.color).toBe(`rgba(255, 255, 255, ${alpha})`);
    }
    await pressKey(KEY.right);
    expect(valueOf('textOpacity')).toBe('100 %');
    expect(previewLine().style.color).toBe('rgb(255, 255, 255)');
  });

  it('writes the stored values of the palette end and the opacity steps', async () => {
    const { writes } = serve();
    await open();
    await down(2);
    await pressKey(KEY.left); // white -> gray
    await pressKey(KEY.down);
    await pressKey(KEY.right); // text opacity 100 -> 25
    await pressKey(KEY.right); // 50
    await pressKey(KEY.right); // 75
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.value).toEqual(look({ fontColor: '#808080', textOpacity: 75 }));
  });
});

describe('SubtitleAppearanceScreen timing of the write', () => {
  it('waits 600 ms after a press: nothing at 300 ms, one write by 700 ms', async () => {
    const { writes } = serve();
    await open();
    await pressKey(KEY.right);
    await pause(300);
    expect(writes).toEqual([]);
    await pause(400);
    expect(writes).toHaveLength(1);
    expect(SAVE_DELAY_MS).toBe(600);
  });

  it('is a debounce: a second press at about 400 ms moves the write to after it', async () => {
    const { writes } = serve();
    await open();
    await pressKey(KEY.right);
    await pause(400);
    await pressKey(KEY.right);
    // The first press alone would have been written by now.
    await pause(300);
    expect(writes).toEqual([]);
    await pause(500);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.value).toEqual(look({ fontSize: 'xxlarge' }));
  });

  it('sends nothing for a change that was reset before it was written, also when the page is left', async () => {
    const { writes } = serve();
    const view = await open();
    await pressKey(KEY.right);
    await down(9);
    await pressKey(KEY.enter);
    await waitFor(() => expect(writes).toHaveLength(1));
    view.unmount();
    await settle();
    expect(writes.map((w) => w.method)).toEqual(['DELETE']);
  });

  it('runs a reset only after a write that is still in flight', async () => {
    let release!: () => void;
    const putGate = new Promise<void>((resolve) => (release = resolve));
    const { writes } = serve({ putGate });
    await open();
    await pressKey(KEY.right);
    await waitFor(() => expect(writes.map((w) => w.method)).toEqual(['PUT']));
    await down(9);
    await pressKey(KEY.enter);
    await pause(200);
    expect(writes.map((w) => w.method)).toEqual(['PUT']);
    release();
    await waitFor(() => expect(writes.map((w) => w.method)).toEqual(['PUT', 'DELETE']));
  });

  it('takes the error line away when a reset succeeds after a failed write', async () => {
    serve({ put: 500 });
    await open();
    await pressKey(KEY.right);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    await down(9);
    await pressKey(KEY.enter);
    await waitFor(() => expect(screen.queryByTestId('subtitle-save-error')).toBeNull());
    expect(valueOf('size')).toBe('Large');
  });
});

describe('SubtitleAppearanceScreen reset while a change is made', () => {
  const chevron = (id: string, at: 0 | 1) =>
    row(id).querySelectorAll<HTMLElement>('.subtitle-chevron')[at]!;
  const resetButton = () => screen.getByRole('button', { name: 'Reset' });
  const methods = (writes: Write[]) => writes.map((w) => w.method);

  it('keeps a change made while the delete is in flight, and the next press builds on it', async () => {
    let release!: () => void;
    const delGate = new Promise<void>((resolve) => (release = resolve));
    const { writes } = serve({ delGate });
    await open();
    fireEvent.click(chevron('size', 1)); // large -> xlarge, dropped by the reset
    fireEvent.click(resetButton());
    await waitFor(() => expect(methods(writes)).toEqual(['DELETE']));
    fireEvent.click(chevron('font', 1)); // standard -> serif, while the delete is in flight
    fireEvent.click(chevron('size', 1)); // builds on the shown look: xlarge -> xxlarge
    expect(valueOf('size')).toBe('Huge');
    release();
    // The finished reset did not throw the newer look away (checked before its own write lands
    // and puts the same look into the cache).
    await pause(200);
    expect(methods(writes)).toEqual(['DELETE']);
    expect(valueOf('size')).toBe('Huge');
    expect(valueOf('font')).toBe('Serif');
    await waitFor(() => expect(methods(writes)).toEqual(['DELETE', 'PUT']));
    expect(writes[1]!.value).toEqual(look({ fontSize: 'xxlarge', fontFamily: 'serif' }));
  });

  it('builds a press made after the delete finished on the newer look, not on the effective value', async () => {
    let release!: () => void;
    const delGate = new Promise<void>((resolve) => (release = resolve));
    const { writes } = serve({ delGate });
    await open();
    fireEvent.click(resetButton());
    await waitFor(() => expect(methods(writes)).toEqual(['DELETE']));
    fireEvent.click(chevron('size', 1)); // large -> xlarge
    release();
    await pause(100);
    fireEvent.click(chevron('size', 1)); // xlarge -> xxlarge, not large -> xlarge
    expect(valueOf('size')).toBe('Huge');
    await waitFor(() => expect(methods(writes)).toEqual(['DELETE', 'PUT']));
    expect(writes[1]!.value).toEqual(look({ fontSize: 'xxlarge' }));
  });

  it('follows the effective value after a reset when nothing was changed meanwhile', async () => {
    let release!: () => void;
    const delGate = new Promise<void>((resolve) => (release = resolve));
    const { writes } = serve({ delGate, values: { [STORED_KEY]: look({ fontSize: 'small' }) } });
    await open();
    expect(valueOf('size')).toBe('Small');
    fireEvent.click(resetButton());
    await waitFor(() => expect(methods(writes)).toEqual(['DELETE']));
    release();
    await waitFor(() => expect(valueOf('size')).toBe('Large'));
    await settle();
    expect(writes).toHaveLength(1);
  });
});

describe('SubtitleAppearanceScreen failed saves', () => {
  const realTimeout = globalThis.setTimeout;
  const realTick = () => new Promise<void>((resolve) => realTimeout(resolve, 5));
  const chevron = () => row('size').querySelectorAll<HTMLElement>('.subtitle-chevron')[1]!;
  const alertText = () => screen.queryByTestId('subtitle-save-error')?.textContent ?? null;
  const sizes = (writes: Write[]) => writes.map((w) => (w.value as SubtitleAppearance).fontSize);

  /** Moves the fake clock and lets the answers of the mocked server arrive on the way. */
  async function advance(ms: number) {
    for (let left = ms; left > 0; left -= 500) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(Math.min(500, left));
        await realTick();
      });
    }
  }
  async function until(condition: () => boolean) {
    for (let i = 0; i < 400 && !condition(); i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
        await realTick();
      });
    }
    expect(condition()).toBe(true);
  }

  /** Opens the page with real timers, then fakes the clock; presses are clicks (pressKey waits on timers). */
  async function openOnFakeClock() {
    const view = await open();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    return view;
  }
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries after 2 s, 5 s and 15 s, shows the retry line meanwhile, and a success removes it', async () => {
    expect(RETRY_DELAYS_MS).toEqual([2000, 5000, 15000]);
    const answers: PutAnswer[] = ['network', 503, 503, 200];
    const { writes } = serve({ put: () => answers.shift() ?? 200 });
    await openOnFakeClock();
    fireEvent.click(chevron());
    await until(() => writes.length === 1);
    await until(() => alertText() !== null);
    expect(alertText()).toBe('Could not be saved. Trying again …');
    expect(valueOf('size')).toBe('Extra large');
    await advance(1500);
    expect(writes).toHaveLength(1);
    await advance(1000);
    await until(() => writes.length === 2);
    await advance(4000);
    expect(writes).toHaveLength(2);
    await advance(1500);
    await until(() => writes.length === 3);
    expect(alertText()).toBe('Could not be saved. Trying again …');
    await advance(13000);
    expect(writes).toHaveLength(3);
    await advance(3000);
    await until(() => writes.length === 4);
    await until(() => alertText() === null);
    expect(sizes(writes)).toEqual(['xlarge', 'xlarge', 'xlarge', 'xlarge']);
    await advance(30000);
    expect(writes).toHaveLength(4);
  });

  it('gives up after the last retry and then shows the final text', async () => {
    const { writes } = serve({ put: 503 });
    await openOnFakeClock();
    fireEvent.click(chevron());
    await until(() => writes.length === 1);
    await advance(2100);
    await advance(5100);
    await advance(15100);
    await until(() => writes.length === 4);
    await until(() => alertText() === 'Could not be saved');
    await advance(60000);
    expect(writes).toHaveLength(4);
    expect(valueOf('size')).toBe('Extra large');
  });

  it.each([400, 422])('does not retry a %i answer and shows the final text', async (status) => {
    const { writes } = serve({ put: status });
    await openOnFakeClock();
    fireEvent.click(chevron());
    await until(() => writes.length === 1);
    await until(() => alertText() !== null);
    expect(alertText()).toBe('Could not be saved');
    await advance(30000);
    expect(writes).toHaveLength(1);
  });

  it.each([408, 429])('retries a %i answer', async (status) => {
    const answers: PutAnswer[] = [status, 200];
    const { writes } = serve({ put: () => answers.shift() ?? 200 });
    await openOnFakeClock();
    fireEvent.click(chevron());
    await until(() => writes.length === 1);
    await advance(2100);
    await until(() => writes.length === 2);
  });

  it('cancels a scheduled retry on a new change, sends the newest look after the debounce and counts again', async () => {
    const answers: PutAnswer[] = [503, 503, 200];
    const { writes } = serve({ put: () => answers.shift() ?? 200 });
    await openOnFakeClock();
    fireEvent.click(chevron());
    await until(() => writes.length === 1);
    await advance(1000);
    fireEvent.click(chevron()); // xlarge -> xxlarge, while the retry is scheduled
    await advance(700);
    await until(() => writes.length === 2);
    expect(sizes(writes)).toEqual(['xlarge', 'xxlarge']);
    // The retry count started again: the next try comes after 2 s, not 5 s.
    await advance(1500);
    expect(writes).toHaveLength(2);
    await advance(1000);
    await until(() => writes.length === 3);
    expect(sizes(writes)).toEqual(['xlarge', 'xxlarge', 'xxlarge']);
    await advance(30000);
    expect(writes).toHaveLength(3);
  });

  it('sends the unsaved look once more when the page is left after a failed save', async () => {
    const answers: PutAnswer[] = [503, 200];
    const { writes } = serve({ put: () => answers.shift() ?? 200 });
    const view = await openOnFakeClock();
    fireEvent.click(chevron());
    await until(() => writes.length === 1);
    await until(() => alertText() !== null);
    view.unmount();
    await until(() => writes.length === 2);
    expect(writes[1]!.value).toEqual(look({ fontSize: 'xlarge' }));
    // The scheduled retry died with the page.
    await advance(30000);
    expect(writes).toHaveLength(2);
  });

  it('does not retry after the page is left while a write fails', async () => {
    let release!: () => void;
    const putGate = new Promise<void>((resolve) => (release = resolve));
    const { writes } = serve({ put: 503, putGate });
    const view = await openOnFakeClock();
    fireEvent.click(chevron());
    await until(() => writes.length === 1);
    view.unmount();
    release();
    await advance(30000);
    expect(writes).toHaveLength(1);
  });

  it('lets a newer look win over a failed older one', async () => {
    let release!: () => void;
    const putGate = new Promise<void>((resolve) => (release = resolve));
    const answers: PutAnswer[] = [503, 200];
    const { writes } = serve({ put: () => answers.shift() ?? 200, putGate });
    await openOnFakeClock();
    fireEvent.click(chevron()); // xlarge
    await until(() => writes.length === 1);
    fireEvent.click(chevron()); // xxlarge, while the first write is in flight
    release(); // the first write fails now
    await advance(700);
    await until(() => writes.length === 2);
    expect(sizes(writes)).toEqual(['xlarge', 'xxlarge']);
    await advance(30000);
    expect(writes).toHaveLength(2);
    await until(() => alertText() === null);
  });
});

describe('SubtitleAppearanceScreen pointer and preview', () => {
  const chevrons = (id: string) => row(id).querySelectorAll<HTMLElement>('.subtitle-chevron');

  it('steps back with a click on the left arrow and forward with the right one, one step each', async () => {
    serve();
    await open();
    fireEvent.click(chevrons('size')[0]!);
    expect(valueOf('size')).toBe('Medium');
    fireEvent.click(chevrons('size')[1]!);
    expect(valueOf('size')).toBe('Large');
    fireEvent.click(chevrons('size')[1]!);
    expect(valueOf('size')).toBe('Extra large');
    // A click elsewhere on the row steps forward, like OK.
    fireEvent.click(screen.getByText('Font size'));
    expect(valueOf('size')).toBe('Huge');
  });

  it('never lifts the preview block above the controls', async () => {
    serve();
    await open();
    expect(screen.getByTestId('subtitle-preview-block').style.transform).toBe('');
  });

  it('draws the colour swatch in the colour of the row', async () => {
    serve();
    await open();
    const swatch = (id: string) => row(id).querySelector<HTMLElement>('.subtitle-swatch')!;
    expect(swatch('fontColor').style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(swatch('backgroundColor').style.backgroundColor).toBe('rgb(0, 0, 0)');
    fireEvent.click(chevrons('fontColor')[1]!);
    expect(swatch('fontColor').style.backgroundColor).toBe('rgb(255, 255, 0)');
    fireEvent.click(chevrons('backgroundColor')[0]!);
    expect(swatch('backgroundColor').style.backgroundColor).toBe('rgb(0, 0, 255)');
    expect(row('size').querySelector('.subtitle-swatch')).toBeNull();
  });
});
