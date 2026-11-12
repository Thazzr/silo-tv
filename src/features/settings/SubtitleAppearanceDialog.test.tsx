import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Focusable } from '../../app/nav';
import { Session } from '../../api/session';
import { account, BASE_URL } from '../../test/apiFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { serveSettings } from '../../test/settingsFixtures';
import { subtitleStyles } from '../../playback/subtitles/appearance';
import {
  DEFAULT_SUBTITLE_APPEARANCE,
  useProfileSettings,
  type SubtitleAppearance,
} from './profileSettings';
import { SubtitleAppearanceDialog } from './SubtitleAppearanceDialog';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(async () => {
  // A write that is still on its way must reach this test's handlers, not the next one's.
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
  scope: string | null;
  value?: unknown;
}

interface Serve {
  /** The stored values of the profile; a DELETE at the profile scope removes the key from it. */
  values?: Record<string, unknown>;
  /** The status the PUT answers with. */
  put?: number | (() => number);
  /** The PUT is answered only once this has settled (it is recorded when it arrives). */
  putGate?: Promise<void>;
  /** The status a DELETE answers with, by scope. */
  del?: Partial<Record<'profile' | 'profile_device', number>>;
  /** The DELETE at the profile scope is answered only once this has settled (it is recorded when it arrives). */
  delGate?: Promise<void>;
  /** What the server resolves once the profile's own value is deleted (its own default). */
  serverDefault?: SubtitleAppearance;
}

/** The settings reads plus a PUT and a DELETE that record what they were sent. */
function serve(options: Serve = {}) {
  const writes: Write[] = [];
  const values = options.values ?? {};
  serveSettings(server, { values });
  server.use(
    http.put(`${BASE_URL}/api/v2/settings/values/:key`, async ({ request, params }) => {
      const body = (await request.json()) as { value: unknown };
      expect(params.key).toBe(STORED_KEY);
      writes.push({
        method: 'PUT',
        scope: new URL(request.url).searchParams.get('scope'),
        value: body.value,
      });
      await options.putGate;
      const status = typeof options.put === 'function' ? options.put() : (options.put ?? 200);
      if (status !== 200) return new HttpResponse(null, { status });
      values[String(params.key)] = body.value;
      return HttpResponse.json({
        key: params.key,
        scope: 'profile',
        value: body.value,
        revision: 1,
      });
    }),
    http.delete(`${BASE_URL}/api/v2/settings/values/:key`, async ({ request, params }) => {
      expect(params.key).toBe(STORED_KEY);
      const scope = new URL(request.url).searchParams.get('scope') as 'profile' | 'profile_device';
      writes.push({ method: 'DELETE', scope });
      if (scope === 'profile') await options.delGate;
      const status = options.del?.[scope] ?? 204;
      if (status === 204 && scope === 'profile') {
        if (options.serverDefault) values[String(params.key)] = options.serverDefault;
        else delete values[String(params.key)];
      }
      return new HttpResponse(null, { status });
    }),
  );
  return { writes, values };
}

const look = (over: Partial<SubtitleAppearance> = {}): SubtitleAppearance => ({
  ...DEFAULT_SUBTITLE_APPEARANCE,
  ...over,
});

const row = (id: string) => screen.getByTestId(`subtitle-dialog-${id}`);
const rowIds = () =>
  Array.from(document.querySelectorAll('.subtitle-row')).map((el) =>
    el.getAttribute('data-testid')!.replace('subtitle-dialog-', ''),
  );
/** What the row's chips or swatches say is selected (the chip's text, or the swatch's name). */
const selected = (id: string) =>
  within(row(id))
    .getAllByRole('radio')
    .filter((el) => el.getAttribute('aria-checked') === 'true')
    .map((el) => el.getAttribute('aria-label') ?? el.textContent);
const focusKey = () => document.activeElement?.getAttribute('data-focus-key');
const pause = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

/** The dialog opens once the profile's values are read, as it does from the player and Settings. */
function Host({ onClose }: { onClose: () => void }) {
  const { known } = useProfileSettings();
  return known ? <SubtitleAppearanceDialog onClose={onClose} /> : null;
}

/** Renders the dialog on its own and waits for its first row to take the focus. */
async function open(options: { lang?: 'de' | 'en'; onClose?: () => void } = {}) {
  const view = renderWithSilo(<Host onClose={options.onClose ?? (() => undefined)} />, {
    session: sessionOf(),
    ...(options.lang ? { lang: options.lang } : {}),
  });
  await waitFor(() => expect(focusKey()).toBe('subtitle-dialog-size'));
  return view;
}

describe('SubtitleAppearanceDialog rows', () => {
  it('has the web dialog sections and rows in order, with Background Opacity and Color for Box', async () => {
    serve();
    await open();
    expect(rowIds()).toEqual([
      'size',
      'font',
      'fontColor',
      'textOpacity',
      'outline',
      'style',
      'backgroundOpacity',
      'backgroundColor',
      'position',
    ]);
    expect(Array.from(document.querySelectorAll('h3')).map((el) => el.textContent)).toEqual([
      'Text',
      'Background',
      'Position',
    ]);
    // Each section's heading stands right before its first row.
    const body = document.querySelector('.subtitle-dialog-body')!;
    expect(Array.from(body.children).map((el) => el.tagName)).toEqual([
      'H3',
      'BUTTON',
      'BUTTON',
      'BUTTON',
      'BUTTON',
      'BUTTON',
      'H3',
      'BUTTON',
      'BUTTON',
      'BUTTON',
      'H3',
      'BUTTON',
    ]);
  });

  it('shows the web defaults as selected', async () => {
    serve();
    await open();
    expect(selected('size')).toEqual(['Large']);
    expect(selected('font')).toEqual(['Sans-serif']);
    expect(selected('fontColor')).toEqual(['White']);
    expect(row('textOpacity')).toHaveAttribute('aria-valuenow', '100');
    expect(within(row('textOpacity')).getByText('100 %')).toBeInTheDocument();
    expect(row('outline')).toHaveAttribute('aria-checked', 'false');
    expect(selected('style')).toEqual(['Box']);
    expect(within(row('backgroundOpacity')).getByText('75 %')).toBeInTheDocument();
    expect(selected('backgroundColor')).toEqual(['Black']);
    expect(selected('position')).toEqual(['Bottom']);
  });

  it('offers the web choices in the web order', async () => {
    serve();
    await open();
    const names = (id: string) =>
      within(row(id))
        .getAllByRole('radio')
        .map((el) => el.getAttribute('aria-label') ?? el.textContent);
    expect(names('size')).toEqual(['Small', 'Medium', 'Large', 'X-Large', 'XX-Large']);
    expect(names('font')).toEqual(['Sans-serif', 'Serif', 'Monospace']);
    expect(names('fontColor')).toEqual([
      'White',
      'Yellow',
      'Green',
      'Cyan',
      'Magenta',
      'Red',
      'Blue',
      'Gray',
      'Black',
    ]);
    expect(names('style')).toEqual(['Box', 'Drop Shadow', 'Outline', 'None']);
    expect(names('backgroundColor')).toEqual([
      'Black',
      'Dark Gray',
      'Navy',
      'Dark Red',
      'Dark Green',
    ]);
    expect(names('position')).toEqual(['Bottom', 'Lower Third', 'Top']);
  });

  it('hides the background opacity and colour unless the style is Box', async () => {
    serve({ values: { [STORED_KEY]: look({ backgroundStyle: 'shadow' }) } });
    await open();
    expect(rowIds()).toEqual([
      'size',
      'font',
      'fontColor',
      'textOpacity',
      'outline',
      'style',
      'position',
    ]);
    expect(screen.queryByTestId('subtitle-dialog-backgroundOpacity')).toBeNull();
    expect(screen.queryByTestId('subtitle-dialog-backgroundColor')).toBeNull();
  });

  it('adds and removes the two background rows when the style changes', async () => {
    serve();
    await open();
    for (let i = 0; i < 5; i += 1) await pressKey(KEY.down);
    expect(focusKey()).toBe('subtitle-dialog-style');
    await pressKey(KEY.right);
    await waitFor(() => expect(rowIds()).not.toContain('backgroundColor'));
    // Back to Box brings both rows back.
    await pressKey(KEY.left);
    await waitFor(() => expect(rowIds()).toContain('backgroundColor'));
    expect(rowIds()).toContain('backgroundOpacity');
  });

  it('has the web labels in English', async () => {
    serve();
    await open({ lang: 'en' });
    expect(screen.getByRole('dialog', { name: 'Subtitle appearance' })).toBeInTheDocument();
    expect(screen.getByText('Captions')).toBeInTheDocument();
    for (const label of ['Size', 'Font', 'Color', 'Opacity', 'Outline', 'Style', 'Vertical']) {
      expect(
        within(document.querySelector('.subtitle-dialog-body')!).getAllByText(label).length,
      ).toBeGreaterThan(0);
    }
    expect(screen.getByRole('button', { name: 'Use fallback style' })).toBeInTheDocument();
    expect(screen.getByText('Changes saved automatically')).toBeInTheDocument();
  });

  it('has the web labels in German', async () => {
    serve();
    await open({ lang: 'de' });
    expect(screen.getByRole('dialog', { name: 'Darstellung der Untertitel' })).toBeInTheDocument();
    expect(screen.getByText('Untertitel')).toBeInTheDocument();
    expect(Array.from(document.querySelectorAll('h3')).map((el) => el.textContent)).toEqual([
      'Text',
      'Hintergrund',
      'Position',
    ]);
    const labels = Array.from(document.querySelectorAll('.subtitle-row-label')).map(
      (el) => el.textContent,
    );
    expect(labels).toEqual([
      'Größe',
      'Schriftart',
      'Farbe',
      'Deckkraft',
      'Kontur',
      'Stil',
      'Deckkraft',
      'Farbe',
      'Vertikal',
    ]);
    expect(selected('size')).toEqual(['Groß']);
    expect(selected('font')).toEqual(['Serifenlos']);
    expect(selected('fontColor')).toEqual(['Weiß']);
    expect(selected('style')).toEqual(['Box']);
    expect(selected('backgroundColor')).toEqual(['Schwarz']);
    expect(selected('position')).toEqual(['Unten']);
    expect(screen.getByRole('button', { name: 'Ersatzstil verwenden' })).toBeInTheDocument();
    expect(screen.getByText('Änderungen werden automatisch gespeichert')).toBeInTheDocument();
  });
});

describe('SubtitleAppearanceDialog preview', () => {
  const lines = () =>
    Array.from(
      within(screen.getByTestId('subtitle-preview')).getAllByText(/./),
      (el) => el.textContent,
    );

  it("shows the web's two sample lines in English and German", async () => {
    serve();
    await open({ lang: 'en' });
    expect(lines()).toEqual(['The quick brown fox', 'jumps over the lazy dog.']);
    cleanup();
    await open({ lang: 'de' });
    expect(lines()).toEqual(['Franz jagt im komplett', 'verwahrlosten Taxi quer durch Bayern.']);
  });

  it('draws the lines with the stored look', async () => {
    serve({
      values: {
        [STORED_KEY]: look({ fontColor: '#facc15', backgroundOpacity: 50, position: 'top' }),
      },
    });
    await open();
    const line = within(screen.getByTestId('subtitle-preview')).getByText('The quick brown fox');
    expect(line).toHaveStyle({
      color: 'rgba(250, 204, 21, 1)',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
    });
    expect(screen.getByTestId('subtitle-preview-block')).toHaveAttribute('data-position', 'top');
  });

  it('follows every change at once, before the server has answered', async () => {
    // The write never finishes: what the preview shows is the viewer's change, not the server's.
    serve({ putGate: new Promise<void>(() => undefined) });
    await open();
    const line = () =>
      within(screen.getByTestId('subtitle-preview')).getByText('The quick brown fox');
    const before = line().style.fontSize;
    await pressKey(KEY.right);
    expect(line().style.fontSize).not.toBe(before);
    expect(selected('size')).toEqual(['X-Large']);
    // Colour, then the position: three rows further down.
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    expect(line()).toHaveStyle({ color: 'rgba(250, 204, 21, 1)' });
    for (let i = 0; i < 6; i += 1) await pressKey(KEY.down);
    expect(focusKey()).toBe('subtitle-dialog-position');
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    expect(screen.getByTestId('subtitle-preview-block')).toHaveAttribute('data-position', 'top');
    expect(screen.getByTestId('subtitle-preview-block').style.top).not.toBe('');
  });
});

describe('SubtitleAppearanceDialog preview size', () => {
  // The cues of the preview have the size they have over the video (the web player's, on 1080p).
  it.each([
    ['small', 'Klein', '30px'],
    ['medium', 'Mittel', '39px'],
    ['large', 'Groß', '48px'],
    ['xlarge', 'Sehr groß', '60px'],
    ['xxlarge', 'Extrem groß', '72px'],
  ] as const)('draws "%s" cues at %s px, as the player does', async (size, _name, px) => {
    serve({ values: { [STORED_KEY]: look({ fontSize: size }) } });
    await open();
    const line = within(screen.getByTestId('subtitle-preview')).getByText('The quick brown fox');
    expect(line.style.fontSize).toBe(px);
    expect(line.style.fontSize).toBe(subtitleStyles(look({ fontSize: size }), 0).line.fontSize);
  });

  it('is tall enough for two wrapped lines at the largest size above the lowest position', async () => {
    serve();
    await open();
    const preview = screen.getByTestId('subtitle-preview');
    // Two sample lines of up to two rows each: 4 x (72 x 1.25 + 4) px, and the resting gap.
    expect(parseFloat(preview.style.height)).toBeGreaterThanOrEqual(4 * (72 * 1.25 + 4) + 12);
  });
});

describe('SubtitleAppearanceDialog keys', () => {
  it('Up and Down walk the rows and the reset button, and hold at both ends', async () => {
    serve();
    await open();
    await pressKey(KEY.up);
    expect(focusKey()).toBe('subtitle-dialog-size');
    for (const id of rowIds().slice(1)) {
      await pressKey(KEY.down);
      expect(focusKey()).toBe(`subtitle-dialog-${id}`);
    }
    await pressKey(KEY.down);
    expect(focusKey()).toBe('subtitle-dialog-reset');
    await pressKey(KEY.down);
    expect(focusKey()).toBe('subtitle-dialog-reset');
    await pressKey(KEY.up);
    expect(focusKey()).toBe('subtitle-dialog-position');
  });

  it('skips the hidden background rows going down and up', async () => {
    serve({ values: { [STORED_KEY]: look({ backgroundStyle: 'none' }) } });
    await open();
    for (let i = 0; i < 5; i += 1) await pressKey(KEY.down);
    expect(focusKey()).toBe('subtitle-dialog-style');
    await pressKey(KEY.down);
    expect(focusKey()).toBe('subtitle-dialog-position');
    await pressKey(KEY.up);
    expect(focusKey()).toBe('subtitle-dialog-style');
  });

  it('Left and Right choose the neighbouring chip, and hold at the ends', async () => {
    const { writes } = serve({ values: { [STORED_KEY]: look({ fontSize: 'xlarge' }) } });
    await open();
    await pressKey(KEY.right);
    expect(selected('size')).toEqual(['XX-Large']);
    await pressKey(KEY.right);
    expect(selected('size')).toEqual(['XX-Large']);
    await pressKey(KEY.left);
    await pressKey(KEY.left);
    await pressKey(KEY.left);
    await pressKey(KEY.left);
    expect(selected('size')).toEqual(['Small']);
    await pressKey(KEY.left);
    expect(selected('size')).toEqual(['Small']);
    await waitFor(() => expect(writes.filter((w) => w.method === 'PUT')).toHaveLength(5));
  });

  it('Left and Right choose the neighbouring swatch', async () => {
    serve();
    await open();
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    expect(selected('fontColor')).toEqual(['Yellow']);
    await pressKey(KEY.left);
    await pressKey(KEY.left);
    expect(selected('fontColor')).toEqual(['White']);
  });

  it('a stored colour that is no swatch marks none; Right takes the first and Left the last', async () => {
    serve({ values: { [STORED_KEY]: look({ fontColor: '#123456' }) } });
    await open();
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    expect(selected('fontColor')).toEqual([]);
    await pressKey(KEY.right);
    expect(selected('fontColor')).toEqual(['White']);
  });

  it('steps the text opacity by 5 and holds at 1 and 100', async () => {
    const { writes } = serve({ values: { [STORED_KEY]: look({ textOpacity: 100 }) } });
    await open();
    for (let i = 0; i < 3; i += 1) await pressKey(KEY.down);
    expect(focusKey()).toBe('subtitle-dialog-textOpacity');
    // At the top a step up changes nothing and writes nothing.
    await pressKey(KEY.right);
    expect(row('textOpacity')).toHaveAttribute('aria-valuenow', '100');
    await pressKey(KEY.left);
    expect(row('textOpacity')).toHaveAttribute('aria-valuenow', '95');
    await pressKey(KEY.left);
    expect(row('textOpacity')).toHaveAttribute('aria-valuenow', '90');
    for (let i = 0; i < 17; i += 1) await pressKey(KEY.left);
    expect(row('textOpacity')).toHaveAttribute('aria-valuenow', '5');
    // The last step down lands on the lowest value the contract allows.
    await pressKey(KEY.left);
    expect(row('textOpacity')).toHaveAttribute('aria-valuenow', '1');
    await pressKey(KEY.left);
    expect(row('textOpacity')).toHaveAttribute('aria-valuenow', '1');
    await pressKey(KEY.right);
    expect(row('textOpacity')).toHaveAttribute('aria-valuenow', '5');
    await waitFor(() => expect(writes.filter((w) => w.method === 'PUT')).toHaveLength(21));
  });

  it('steps the background opacity by 5 from 0 to 100', async () => {
    serve({ values: { [STORED_KEY]: look({ backgroundOpacity: 0 }) } });
    await open();
    for (let i = 0; i < 6; i += 1) await pressKey(KEY.down);
    expect(focusKey()).toBe('subtitle-dialog-backgroundOpacity');
    // 0 is a valid background opacity: Left holds there.
    await pressKey(KEY.left);
    expect(row('backgroundOpacity')).toHaveAttribute('aria-valuenow', '0');
    await pressKey(KEY.right);
    expect(row('backgroundOpacity')).toHaveAttribute('aria-valuenow', '5');
    expect(within(row('backgroundOpacity')).getByText('5 %')).toBeInTheDocument();
    for (let i = 0; i < 19; i += 1) await pressKey(KEY.right);
    expect(row('backgroundOpacity')).toHaveAttribute('aria-valuenow', '100');
    await pressKey(KEY.right);
    expect(row('backgroundOpacity')).toHaveAttribute('aria-valuenow', '100');
  });

  it('steps from a stored opacity that is not a multiple of 5 to the next multiple', async () => {
    serve({ values: { [STORED_KEY]: look({ textOpacity: 73 }) } });
    await open();
    for (let i = 0; i < 3; i += 1) await pressKey(KEY.down);
    await pressKey(KEY.right);
    expect(row('textOpacity')).toHaveAttribute('aria-valuenow', '75');
    await pressKey(KEY.left);
    expect(row('textOpacity')).toHaveAttribute('aria-valuenow', '70');
  });

  it('the outline switch is switched on by Right, off by Left, and toggled by OK', async () => {
    const { writes } = serve();
    await open();
    for (let i = 0; i < 4; i += 1) await pressKey(KEY.down);
    expect(focusKey()).toBe('subtitle-dialog-outline');
    expect(row('outline')).toHaveAttribute('aria-checked', 'false');
    await pressKey(KEY.left);
    expect(row('outline')).toHaveAttribute('aria-checked', 'false');
    await pressKey(KEY.right);
    expect(row('outline')).toHaveAttribute('aria-checked', 'true');
    await pressKey(KEY.right);
    expect(row('outline')).toHaveAttribute('aria-checked', 'true');
    await pressKey(KEY.left);
    expect(row('outline')).toHaveAttribute('aria-checked', 'false');
    await pressKey(KEY.enter);
    expect(row('outline')).toHaveAttribute('aria-checked', 'true');
    await pressKey(KEY.enter);
    expect(row('outline')).toHaveAttribute('aria-checked', 'false');
    await waitFor(() => expect(writes.filter((w) => w.method === 'PUT')).toHaveLength(4));
  });

  it('OK on a row of chips changes nothing', async () => {
    const { writes } = serve();
    await open();
    await pressKey(KEY.enter);
    await pause(100);
    expect(selected('size')).toEqual(['Large']);
    expect(writes).toEqual([]);
  });

  it('a click on a chip or a swatch chooses it, and a click on a step button steps', async () => {
    const { writes } = serve();
    await open();
    fireEvent.click(within(row('font')).getByRole('radio', { name: 'Monospace' }));
    await waitFor(() => expect(selected('font')).toEqual(['Monospace']));
    fireEvent.click(within(row('fontColor')).getByRole('radio', { name: 'Red' }));
    await waitFor(() => expect(selected('fontColor')).toEqual(['Red']));
    fireEvent.click(screen.getByTestId('subtitle-dialog-textOpacity-less'));
    await waitFor(() => expect(row('textOpacity')).toHaveAttribute('aria-valuenow', '95'));
    await waitFor(() => expect(writes.filter((w) => w.method === 'PUT')).toHaveLength(3));
  });

  it('keeps the arrow keys inside the dialog', async () => {
    serve();
    await open();
    for (const keyCode of [KEY.up, KEY.left]) await pressKey(keyCode);
    expect(document.activeElement?.closest('[data-testid="subtitle-dialog"]')).not.toBeNull();
  });

  it('moves the focus to the style row when the style that hides the focused row arrives', async () => {
    serve();
    const { queryClient } = await open();
    for (let i = 0; i < 6; i += 1) await pressKey(KEY.down);
    expect(focusKey()).toBe('subtitle-dialog-backgroundOpacity');
    // The style was changed on another device and the settings were read again.
    act(() => {
      queryClient.setQueriesData<Record<string, unknown>>(
        { queryKey: ['settings', 'effective'] },
        (old) => ({
          ...old,
          [STORED_KEY]: look({ backgroundStyle: 'outline' }),
        }),
      );
    });
    await waitFor(() =>
      expect(screen.queryByTestId('subtitle-dialog-backgroundOpacity')).toBeNull(),
    );
    await waitFor(() => expect(focusKey()).toBe('subtitle-dialog-style'));
  });
});

describe('SubtitleAppearanceDialog hidden rows under the focus', () => {
  it('moves the focus to the style row when the focused background colour row goes', async () => {
    serve();
    const { queryClient } = await open();
    for (let i = 0; i < 7; i += 1) await pressKey(KEY.down);
    expect(focusKey()).toBe('subtitle-dialog-backgroundColor');
    act(() => {
      queryClient.setQueriesData<Record<string, unknown>>(
        { queryKey: ['settings', 'effective'] },
        (old) => ({ ...old, [STORED_KEY]: look({ backgroundStyle: 'shadow' }) }),
      );
    });
    await waitFor(() => expect(screen.queryByTestId('subtitle-dialog-backgroundColor')).toBeNull());
    await waitFor(() => expect(focusKey()).toBe('subtitle-dialog-style'));
  });
});

describe('SubtitleAppearanceDialog Back', () => {
  /** The dialog opened from a button, as from the settings entry. */
  function Opener() {
    const [shown, setShown] = useState(false);
    return (
      <>
        <Focusable focusKey="opener" autoFocus onClick={() => setShown(true)}>
          opener
        </Focusable>
        {shown ? <SubtitleAppearanceDialog onClose={() => setShown(false)} /> : null}
      </>
    );
  }

  it('closes the dialog and gives the focus back to where it was opened from', async () => {
    serve();
    renderWithSilo(<Opener />, { session: sessionOf() });
    await waitFor(() => expect(screen.getByText('opener')).toHaveFocus());
    await pressKey(KEY.enter);
    await screen.findByTestId('subtitle-dialog');
    await waitFor(() => expect(focusKey()).toBe('subtitle-dialog-size'));
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('subtitle-dialog')).toBeNull());
    await waitFor(() => expect(screen.getByText('opener')).toHaveFocus());
  });

  it('asks its owner to close, and a click on the backdrop does the same', async () => {
    serve();
    const onClose = vi.fn();
    await open({ onClose });
    await pressKey(KEY.back);
    expect(onClose).toHaveBeenCalledTimes(1);
    // A click inside the panel is not a click on the backdrop.
    fireEvent.click(screen.getByTestId('subtitle-dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector('.dialog-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('SubtitleAppearanceDialog saving', () => {
  const puts = (writes: Write[]) => writes.filter((w) => w.method === 'PUT');

  it('writes the whole object at the profile scope, then deletes this TV’s own value', async () => {
    const { writes } = serve({ values: { [STORED_KEY]: look({ fontSize: 'small' }) } });
    await open();
    await pressKey(KEY.right);
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes).toEqual([
      { method: 'PUT', scope: 'profile', value: look({ fontSize: 'medium' }) },
      { method: 'DELETE', scope: 'profile_device' },
    ]);
  });

  it('writes the text outline colour that has no row, unchanged, with every change', async () => {
    const { writes } = serve({ values: { [STORED_KEY]: look({ textOutlineColor: '#123456' }) } });
    await open();
    await pressKey(KEY.right);
    await waitFor(() => expect(puts(writes)).toHaveLength(1));
    expect((puts(writes)[0]!.value as SubtitleAppearance).textOutlineColor).toBe('#123456');
  });

  it('writes nothing for a press that changes nothing', async () => {
    const { writes } = serve({ values: { [STORED_KEY]: look({ fontSize: 'xxlarge' }) } });
    await open();
    await pressKey(KEY.right);
    await pause(150);
    expect(writes).toEqual([]);
  });

  it('writes quick presses one after another, in order, and the last value stays', async () => {
    let release = () => undefined as void;
    const putGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { writes, values } = serve({ putGate });
    await open();
    // Three changes while the first write has not been answered: size, font, colour.
    await pressKey(KEY.right);
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    await waitFor(() => expect(puts(writes)).toHaveLength(1));
    // The others wait: nothing overtakes the first write.
    await pause(100);
    expect(writes).toHaveLength(1);
    act(() => release());
    await waitFor(() => expect(puts(writes)).toHaveLength(3));
    await waitFor(() => expect(writes).toHaveLength(6));
    expect(writes.map((w) => `${w.method} ${w.scope}`)).toEqual([
      'PUT profile',
      'DELETE profile_device',
      'PUT profile',
      'DELETE profile_device',
      'PUT profile',
      'DELETE profile_device',
    ]);
    // Every write carries the changes before it; none is lost and none is out of order.
    expect(puts(writes).map((w) => w.value)).toEqual([
      look({ fontSize: 'xlarge' }),
      look({ fontSize: 'xlarge', fontFamily: 'serif' }),
      look({ fontSize: 'xlarge', fontFamily: 'serif', fontColor: '#facc15' }),
    ]);
    expect(values[STORED_KEY]).toEqual(
      look({ fontSize: 'xlarge', fontFamily: 'serif', fontColor: '#facc15' }),
    );
    expect(selected('size')).toEqual(['X-Large']);
    expect(selected('font')).toEqual(['Serif']);
    expect(selected('fontColor')).toEqual(['Yellow']);
  });

  it('shows no error and goes back to the stored value when a write fails', async () => {
    let release = () => undefined as void;
    const putGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { writes } = serve({
      put: 500,
      putGate,
      values: { [STORED_KEY]: look({ fontSize: 'small' }) },
    });
    await open();
    await pressKey(KEY.right);
    await waitFor(() => expect(puts(writes)).toHaveLength(1));
    // Shown at once, while the server has not answered yet ...
    expect(selected('size')).toEqual(['Medium']);
    act(() => release());
    // ... and back on the last stored value once the server refused. No popup, no message.
    await waitFor(() => expect(selected('size')).toEqual(['Small']));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(writes.filter((w) => w.method === 'DELETE')).toEqual([]);
  });

  it('retries with the next change after a failed write', async () => {
    let status = 500;
    const { writes } = serve({
      put: () => status,
      values: { [STORED_KEY]: look({ fontSize: 'small' }) },
    });
    await open();
    await pressKey(KEY.right);
    await waitFor(() => expect(selected('size')).toEqual(['Small']));
    status = 200;
    await pressKey(KEY.right);
    await waitFor(() => expect(puts(writes)).toHaveLength(2));
    expect(puts(writes)[1]!.value).toEqual(look({ fontSize: 'medium' }));
    await waitFor(() => expect(writes.filter((w) => w.method === 'DELETE')).toHaveLength(1));
    expect(selected('size')).toEqual(['Medium']);
  });

  it('keeps the choice when only the deletion of this TV’s own value fails', async () => {
    const { writes } = serve({ del: { profile_device: 500 } });
    await open();
    await pressKey(KEY.right);
    await waitFor(() => expect(writes).toHaveLength(2));
    await pause(100);
    expect(selected('size')).toEqual(['X-Large']);
  });

  it('a first write that fails does not stop the ones queued behind it', async () => {
    let release = () => undefined as void;
    const putGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const { writes } = serve({ putGate, put: () => (++calls === 1 ? 500 : 200) });
    await open();
    // Both changes are made while the first write is still on its way.
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    act(() => release());
    await waitFor(() => expect(puts(writes)).toHaveLength(2));
    // The second write carries the first change too, so the shown look survives the failure.
    expect((puts(writes)[1]!.value as SubtitleAppearance).fontSize).toBe('xxlarge');
    await pause(150);
    expect(selected('size')).toEqual(['XX-Large']);
  });
});

describe('SubtitleAppearanceDialog reset', () => {
  it('deletes the stored value at the profile and at this TV, and writes nothing', async () => {
    const { writes } = serve({
      values: { [STORED_KEY]: look({ fontSize: 'xxlarge', backgroundStyle: 'none' }) },
    });
    await open();
    expect(selected('size')).toEqual(['XX-Large']);
    fireEvent.click(screen.getByRole('button', { name: 'Use fallback style' }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes).toEqual([
      { method: 'DELETE', scope: 'profile' },
      { method: 'DELETE', scope: 'profile_device' },
    ]);
    // The server's default applies again.
    await waitFor(() => expect(selected('size')).toEqual(['Large']));
    expect(selected('style')).toEqual(['Box']);
  });

  it('ignores a value that was not there to delete', async () => {
    const { writes } = serve({
      del: { profile_device: 404 },
      values: { [STORED_KEY]: look({ fontSize: 'xxlarge' }) },
    });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Use fallback style' }));
    await waitFor(() => expect(writes).toHaveLength(2));
    await waitFor(() => expect(selected('size')).toEqual(['Large']));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores a missing value at the profile scope too, and still deletes at this TV', async () => {
    const { writes } = serve({ del: { profile: 404 } });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Use fallback style' }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes.map((w) => `${w.method} ${w.scope}`)).toEqual([
      'DELETE profile',
      'DELETE profile_device',
    ]);
  });

  it('is reached with Down from the last row, and OK on it resets', async () => {
    const { writes } = serve({ values: { [STORED_KEY]: look({ position: 'top' }) } });
    await open();
    for (let i = 0; i < 9; i += 1) await pressKey(KEY.down);
    expect(focusKey()).toBe('subtitle-dialog-reset');
    // Left and Right have no meaning on the button.
    await pressKey(KEY.right);
    await pressKey(KEY.left);
    expect(focusKey()).toBe('subtitle-dialog-reset');
    expect(writes).toEqual([]);
    await pressKey(KEY.enter);
    await waitFor(() =>
      expect(writes.map((w) => `${w.method} ${w.scope}`)).toEqual([
        'DELETE profile',
        'DELETE profile_device',
      ]),
    );
  });
});

describe('SubtitleAppearanceDialog reset and the queue behind it', () => {
  const reset = () => fireEvent.click(screen.getByRole('button', { name: 'Use fallback style' }));
  const chip = (id: string, name: string) =>
    fireEvent.click(within(row(id)).getByRole('radio', { name }));

  it('shows what the server resolves after the reset, not the app’s own default', async () => {
    serve({
      values: { [STORED_KEY]: look({ fontSize: 'xxlarge' }) },
      serverDefault: look({ fontSize: 'small' }),
    });
    await open();
    reset();
    await waitFor(() => expect(selected('size')).toEqual(['Small']));
  });

  it('keeps a change queued right behind the reset', async () => {
    let release = () => undefined as void;
    const delGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { writes } = serve({
      values: { [STORED_KEY]: look({ fontSize: 'small' }) },
      serverDefault: look({ fontSize: 'medium' }),
      delGate,
    });
    await open();
    reset();
    chip('size', 'XX-Large');
    act(() => release());
    await waitFor(() => expect(writes.filter((w) => w.method === 'PUT')).toHaveLength(1));
    await waitFor(() => expect(writes).toHaveLength(4));
    await pause(150);
    expect(selected('size')).toEqual(['XX-Large']);
  });

  it('shows the default, not the value before the reset, when the change behind it fails', async () => {
    let release = () => undefined as void;
    const delGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    serve({
      values: { [STORED_KEY]: look({ fontSize: 'xxlarge' }) },
      put: 500,
      delGate,
    });
    await open();
    reset();
    chip('font', 'Monospace');
    act(() => release());
    // The failed change is shown until the server has refused it, so wait for the revert.
    await waitFor(() => expect(selected('font')).toEqual(['Sans-serif']));
    expect(selected('size')).toEqual(['Large']);
  });

  it('shows the previous value again when the reset’s DELETE fails', async () => {
    const { writes } = serve({
      values: { [STORED_KEY]: look({ fontSize: 'xxlarge' }) },
      del: { profile: 500 },
    });
    await open();
    reset();
    await waitFor(() => expect(writes).toHaveLength(1));
    await waitFor(() => expect(selected('size')).toEqual(['XX-Large']));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the default at once, while the reset’s DELETE is still pending', async () => {
    serve({
      values: { [STORED_KEY]: look({ fontSize: 'xxlarge' }) },
      delGate: new Promise<void>(() => undefined),
    });
    await open();
    reset();
    await waitFor(() => expect(selected('size')).toEqual(['Large']));
    const line = within(screen.getByTestId('subtitle-preview')).getByText('The quick brown fox');
    expect(line.style.fontSize).toBe('48px');
  });

  it('shows the first change when the second of two quick changes fails', async () => {
    let release = () => undefined as void;
    const putGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const { writes } = serve({ putGate, put: () => (++calls === 1 ? 200 : 500) });
    await open();
    chip('size', 'X-Large');
    chip('font', 'Serif');
    act(() => release());
    await waitFor(() => expect(writes.filter((w) => w.method === 'PUT')).toHaveLength(2));
    // The failed second change is shown until the server has refused it, so wait for the revert.
    await waitFor(() => expect(selected('font')).toEqual(['Sans-serif']));
    expect(selected('size')).toEqual(['X-Large']);
  });
});
