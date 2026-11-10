// The scrub preview card and the chapter ticks on the real PlayerScreen, driven by key and mouse
// events like PlayerControls.test.tsx: real timers while the session and the trickplay read load
// (MSW needs them), then a fake clock for the timing rules.
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../api/generated/schema';
import { Session } from '../../api/session';
import { account, BASE_URL } from '../../test/apiFixtures';
import { fakeVideo, installFakeMedia } from '../../test/fakeVideo';
import {
  ACCESS_TOKEN,
  playableDecision,
  playbackCapabilities,
  playbackPlan,
  servePlayback,
  serveTrickplay,
  TRICKPLAY_FEATURES,
  trickplayManifest,
  watchDetail,
  watchVersion,
  type TrickplayCall,
} from '../../test/playbackFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { serveSettings } from '../../test/settingsFixtures';
import { PlayerScreen } from '../PlayerScreen';
import { clearInstallationCache } from '../usePlaybackSession';

type S = components['schemas'];

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

let restoreMedia: () => void;
let restoreWidth: () => void;
beforeEach(() => {
  window.localStorage.clear();
  clearInstallationCache();
  restoreMedia = installFakeMedia();
  // The scrubber is 1000 px wide in these tests (jsdom has no layout).
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('player-osd-scrubwrap') ? 1000 : 0;
    },
  });
  restoreWidth = () => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', original);
    else delete (HTMLElement.prototype as { offsetWidth?: number }).offsetWidth;
  };
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreMedia();
  restoreWidth();
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 30));
  server.resetHandlers();
});

const K = { ok: 13, right: 39, up: 38, rewind: 412, fastForward: 417 };
const down = (keyCode: number) => fireEvent.keyDown(window, { keyCode });
const up = (keyCode: number) => fireEvent.keyUp(window, { keyCode });
const tap = (keyCode: number) => {
  down(keyCode);
  up(keyCode);
};
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

const chapterOf = (
  index: number,
  start: number,
  end: number,
  title: string,
): S['WatchChapter'] => ({
  index,
  source: 'file',
  start_seconds: start,
  end_seconds: end,
  title,
});

interface Options {
  /** The server lists trickplay_v1. */
  server?: boolean;
  /** The playing version has previews. */
  version?: boolean;
  /** What the trickplay read answers: a manifest, or an error status. */
  answer?: S['WatchTrickplay'] | number;
  chapters?: S['WatchChapter'][];
  /** The file the plan plays. */
  effectiveFile?: string;
}

async function mount(options: Options = {}) {
  const { version = true, chapters = [], effectiveFile = 'file-1' } = options;
  const offered = options.server ?? true;
  const trickplay: TrickplayCall[] = serveTrickplay(server, options.answer ?? trickplayManifest());
  servePlayback(server, {
    capabilities: playbackCapabilities({
      features: offered ? TRICKPLAY_FEATURES : ['playback_plan_v3', 'sequenced_progress_v1'],
    }),
    watch: watchDetail({
      versions: [
        watchVersion({ file_id: 'file-1', trickplay_available: version, chapters }),
        watchVersion({ file_id: 'file-2', trickplay_available: version, chapters }),
      ],
    }),
    start: [
      playableDecision(
        playbackPlan({ effective_media_file_id: effectiveFile, requested_media_file_id: 'file-1' }),
      ),
    ],
  });
  serveSettings(server, {});
  const session = new Session(memoryStorage());
  session.set({
    accessToken: ACCESS_TOKEN,
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const view = renderWithSilo(
    <PlayerScreen contentId="m1" title="First Title" onExit={vi.fn()} />,
    { session },
  );
  await screen.findByTestId('player');
  const video = view.container.querySelector('video')!;
  const state = fakeVideo(video);
  state.duration = 5400;
  fireEvent.playing(video);
  // Let the trickplay read (if it is made) finish before the clock is faked.
  await new Promise((resolve) => setTimeout(resolve, 150));
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  return { state, trickplay, video };
}

/** The scrubber's track is 1000 px wide starting at x = 100. */
function placeTrack() {
  const track = document.querySelector('.player-scrubber-track')!;
  track.getBoundingClientRect = () =>
    ({ left: 100, width: 1000, top: 0, right: 1100, bottom: 6, height: 6 }) as DOMRect;
}
const hoverAt = (fraction: number) =>
  fireEvent.mouseMove(screen.getByTestId('player-scrubber'), { clientX: 100 + fraction * 1000 });

const card = () => screen.queryByTestId('player-preview');
const image = () => screen.queryByTestId('player-preview-image');
const SHEET = (n: number) =>
  `${BASE_URL}/api/v2/artwork/trickplay/file-1/rev1/${n}.rev1.jpg?exp=1893456000&sig=sig${n}`;

describe('when the previews are read', () => {
  it('sends no request when the server does not offer trickplay_v1', async () => {
    const { trickplay } = await mount({ server: false });
    expect(trickplay).toHaveLength(0);
  });

  it('sends no request when the playing version has no previews', async () => {
    const { trickplay } = await mount({ version: false });
    expect(trickplay).toHaveLength(0);
  });

  it("reads the plan's effective file, with the profile header", async () => {
    const { trickplay } = await mount({ effectiveFile: 'file-2' });
    expect(trickplay).toHaveLength(1);
    expect(trickplay[0]!.url.pathname).toBe('/api/v2/watch/m1/trickplay');
    expect(trickplay[0]!.url.searchParams.get('file_id')).toBe('file-2');
    expect(trickplay[0]!.headers.get('X-Profile-Id')).toBe('p1');
  });

  it('reads nothing for a file the watch detail does not list', async () => {
    const { trickplay } = await mount({ effectiveFile: 'file-unlisted' });
    expect(trickplay).toHaveLength(0);
  });
});

describe('the preview card', () => {
  it('is not there at rest', async () => {
    await mount();
    tap(K.up);
    expect(card()).not.toBeInTheDocument();
  });

  it('shows for a pending skip with the thumbnail of the target, and goes when the skip commits', async () => {
    const { state } = await mount();
    state.currentTime = 100;
    tap(K.up);
    tap(K.right);
    // 100 s + the default 30 s skip: thumbnail 13, sheet 0, column 3, row 1.
    expect(card()).toBeInTheDocument();
    expect(within(card()!).getByTestId('player-preview-time')).toHaveTextContent('2:10');
    expect(image()).toHaveStyle({
      backgroundImage: `url("${SHEET(0)}")`,
      backgroundSize: '3200px 1344px',
      backgroundPosition: '-960px -134.4px',
    });
    advance(200);
    expect(card()).not.toBeInTheDocument();
  });

  it('shows in scrub mode with the rate, and its image follows the target', async () => {
    const { state } = await mount();
    state.currentTime = 100;
    tap(K.up);
    tap(K.fastForward);
    const scrub = screen.getByTestId('player-scrub');
    expect(card()).toContainElement(scrub);
    expect(scrub).toHaveTextContent('2×');
    expect(scrub).toHaveAttribute('data-rate', '2');
    expect(image()).toBeInTheDocument();
    // 2x for 5 s of wall time moves the target by 10 s: still on sheet 0.
    advance(5_000);
    expect(image()!.style.backgroundImage).toContain('0.rev1.jpg');
    // 2x for another 500 s is 1000 s further: past the first sheet (1000 s).
    advance(500_000);
    expect(image()!.style.backgroundImage).toContain('1.rev1.jpg');
  });

  it('shows on pointer hover without seeking, and goes when the pointer leaves', async () => {
    const { state } = await mount();
    tap(K.up);
    placeTrack();
    hoverAt(0.25);
    // 1350 s: thumbnail 135, sheet 1, column 5, row 3; 300 px thumbnails drawn at 320 px.
    expect(within(card()!).getByTestId('player-preview-time')).toHaveTextContent('22:30');
    expect(image()).toHaveStyle({
      backgroundImage: `url("${SHEET(1)}")`,
      backgroundSize: '3200px 1344px',
      backgroundPosition: '-1600px -403.2px',
    });
    expect(state.seeks).toEqual([]);
    fireEvent.mouseLeave(screen.getByTestId('player-scrubber'));
    expect(card()).not.toBeInTheDocument();
  });

  it('goes with the overlay when it hides while the pointer rests on the scrubber', async () => {
    await mount();
    tap(K.up);
    placeTrack();
    hoverAt(0.25);
    expect(card()).toBeInTheDocument();
    advance(5_000);
    expect(screen.getByTestId('player-osd')).toHaveAttribute('data-visible', 'false');
    expect(card()).not.toBeInTheDocument();
    // Back again by a key: the pointer's old spot does not bring the card back.
    tap(K.up);
    expect(card()).not.toBeInTheDocument();
  });

  it('is centred on the target and kept within the scrubber at both ends', async () => {
    await mount();
    tap(K.up);
    placeTrack();
    hoverAt(0.5);
    // 1000 px track, 352 px card: centred is 500 - 176.
    expect(card()!.style.transform).toBe('translateX(324px)');
    hoverAt(0);
    expect(card()!.style.transform).toBe('translateX(0px)');
    hoverAt(1);
    expect(card()!.style.transform).toBe('translateX(648px)');
  });

  it('uses the sheet URL as given, with no token appended and none logged', async () => {
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mount();
    tap(K.up);
    placeTrack();
    hoverAt(0.25);
    const background = image()!.style.backgroundImage;
    expect(background).toBe(`url("${SHEET(1)}")`);
    expect(background).not.toContain('token=');
    expect(background).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify([...logs.mock.calls, ...warns.mock.calls])).not.toContain('sig=');
  });

  it('keeps an absolute sheet URL (an asset store) untouched', async () => {
    const absolute = 'https://cdn.example.test/t/0.jpg?X-Signature=a%2Bb&exp=1';
    await mount({
      answer: trickplayManifest({
        sheets: [
          { index: 0, url: absolute },
          ...[1, 2, 3, 4, 5].map((i) => ({ index: i, url: `/x/${i}.jpg` })),
        ],
      }),
    });
    tap(K.up);
    placeTrack();
    hoverAt(0.01);
    expect(image()!.style.backgroundImage).toBe(`url("${absolute}")`);
  });

  it('shows the time (no image, no error text) when the read failed', async () => {
    await mount({ answer: 500 });
    tap(K.up);
    placeTrack();
    hoverAt(0.25);
    expect(card()).toBeInTheDocument();
    expect(image()).not.toBeInTheDocument();
    expect(within(card()!).getByTestId('player-preview-time')).toHaveTextContent('22:30');
    expect(card()).toHaveTextContent(/^22:30$/);
  });

  it('shows the time only when the server has no previews at all', async () => {
    await mount({ server: false });
    tap(K.up);
    placeTrack();
    hoverAt(0.25);
    expect(image()).not.toBeInTheDocument();
    expect(card()).toHaveTextContent(/^22:30$/);
  });

  it('shows the chapter title for a target inside a titled chapter, and none otherwise', async () => {
    await mount({
      chapters: [
        chapterOf(0, 0, 1000, 'Opening'),
        chapterOf(1, 1000, 3000, 'The Heist'),
        chapterOf(2, 3000, 5400, ''),
      ],
    });
    tap(K.up);
    placeTrack();
    hoverAt(0.25);
    expect(screen.getByTestId('player-preview-chapter')).toHaveTextContent('The Heist');
    hoverAt(0.05);
    expect(screen.getByTestId('player-preview-chapter')).toHaveTextContent('Opening');
    hoverAt(0.7);
    expect(screen.queryByTestId('player-preview-chapter')).not.toBeInTheDocument();
  });
});

describe('sheet preloading', () => {
  /** Every Image the card creates; one that lost its src is released. */
  function spyOnImages() {
    const created: { src: string }[] = [];
    class SpyImage {
      src = '';
      onload: (() => void) | null = null;
      constructor() {
        created.push(this);
      }
      removeAttribute(name: string) {
        if (name === 'src') this.src = '';
      }
    }
    vi.stubGlobal('Image', SpyImage);
    return () => created.filter((i) => i.src !== '').map((i) => i.src);
  }

  it('holds the current sheet and the next one forward when scrubbing forward', async () => {
    const live = spyOnImages();
    const { state } = await mount();
    state.currentTime = 2500;
    tap(K.up);
    tap(K.fastForward);
    // 2500 s is thumbnail 250: sheet 2; forward preloads sheet 3.
    expect(live().sort()).toEqual([SHEET(2), SHEET(3)]);
  });

  it('holds the previous sheet when scrubbing back', async () => {
    const live = spyOnImages();
    const { state } = await mount();
    state.currentTime = 2500;
    tap(K.up);
    tap(K.rewind);
    expect(live().sort()).toEqual([SHEET(1), SHEET(2)]);
  });

  it('lets go of every sheet when the card goes away', async () => {
    const live = spyOnImages();
    const { state } = await mount();
    state.currentTime = 2500;
    tap(K.up);
    tap(K.fastForward);
    expect(live()).toHaveLength(2);
    tap(K.ok);
    expect(card()).not.toBeInTheDocument();
    expect(live()).toEqual([]);
  });
});

describe('chapter ticks', () => {
  it('stand at every chapter start except 0, visible at rest', async () => {
    await mount({
      chapters: [
        chapterOf(0, 0, 1350, 'A'),
        chapterOf(1, 1350, 2700, 'B'),
        chapterOf(2, 2700, 5400, 'C'),
      ],
    });
    // The overlay is closed: the ticks are part of the track all the same.
    expect(screen.getByTestId('player-osd')).toHaveAttribute('data-visible', 'false');
    const ticks = screen.getAllByTestId('player-chapter-tick');
    expect(ticks.map((t) => t.style.left)).toEqual(['25%', '50%']);
  });

  it('are absent for a file without chapters', async () => {
    await mount();
    expect(screen.queryAllByTestId('player-chapter-tick')).toHaveLength(0);
  });
});
