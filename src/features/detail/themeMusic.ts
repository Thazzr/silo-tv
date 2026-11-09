import type { SiloClient } from '../../api/client';
import { toApiError } from '../../api/client';
import type { components } from '../../api/generated/schema';

type S = components['schemas'];

/** Theme music plays quietly under the page. */
export const THEME_VOLUME = 0.35;
const FADE_STEPS = 10;
const FADE_STEP_MS = 100;

/** The containers and codecs a theme may be asked in, with the media type to ask the element about. */
const CANDIDATES: readonly { format: S['ThemeAudioFormat']; mime: string }[] = [
  { format: { container: 'mp3', audio_codec: 'mp3' }, mime: 'audio/mpeg' },
  { format: { container: 'mp4', audio_codec: 'aac' }, mime: 'audio/mp4; codecs="mp4a.40.2"' },
  { format: { container: 'm4a', audio_codec: 'aac' }, mime: 'audio/mp4; codecs="mp4a.40.2"' },
  { format: { container: 'aac', audio_codec: 'aac' }, mime: 'audio/aac' },
  { format: { container: 'flac', audio_codec: 'flac' }, mime: 'audio/flac' },
  { format: { container: 'ogg', audio_codec: 'vorbis' }, mime: 'audio/ogg; codecs="vorbis"' },
  { format: { container: 'ogg', audio_codec: 'opus' }, mime: 'audio/ogg; codecs="opus"' },
];

/** What this device's audio element reports it can play; `''` means "no". */
export type CanPlayType = (mime: string) => string;

const elementCanPlayType: CanPlayType = (mime) => new Audio().canPlayType(mime);

/** The candidates the device plays: the grant request's `accepted_formats`. */
export function acceptedFormats(canPlayType: CanPlayType): S['ThemeAudioFormat'][] {
  return CANDIDATES.filter(({ mime }) => canPlayType(mime) !== '').map(({ format }) => ({
    ...format,
  }));
}

/**
 * A grant's URL is a credential. Relative to the server, it is resolved against the server's base
 * URL; an absolute one (a proxy node's origin) is used as it is. Nothing is ever appended to it.
 */
export function resolveGrantUrl(url: string, baseUrl: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return new URL(url, baseUrl).href;
}

/** What a grant gives the player: where to play from, and whether the file can loop in place. */
export interface ThemeGrant {
  url: string;
  delivery: S['ThemePlayback']['delivery'];
}

export type GrantRequest = () => Promise<ThemeGrant>;

/** The theme a detail page plays: the first song with a usable id of the item's own set. */
export function firstTheme(
  themes: S['ThemeSongSet'] | undefined,
): { ownerId: string; themeId: string } | null {
  const song = themes?.items.find((item) => /^[1-9][0-9]*$/.test(item.id));
  return song && themes ? { ownerId: themes.owner_id, themeId: song.id } : null;
}

/** Asks for a short-lived grant for one theme. Throws when the server refuses. */
export async function requestThemeGrant(
  client: SiloClient,
  baseUrl: string,
  profileId: string,
  theme: { ownerId: string; themeId: string },
  canPlayType: CanPlayType = elementCanPlayType,
): Promise<ThemeGrant> {
  const formats = acceptedFormats(canPlayType);
  const { data, error, response } = await client.POST(
    '/api/v2/catalog/items/{id}/themes/{theme_id}/playback',
    {
      params: {
        header: { 'X-Profile-Id': profileId },
        path: { id: theme.ownerId, theme_id: theme.themeId },
      },
      // Without a playable candidate the server decides (and may convert).
      body: formats.length > 0 ? { accepted_formats: formats } : undefined,
    },
  );
  if (!data) throw toApiError(error, response);
  return { url: resolveGrantUrl(data.url, baseUrl), delivery: data.delivery };
}

/** The part of an audio element the controller uses. */
export interface ThemeAudio {
  src: string;
  volume: number;
  loop: boolean;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: 'ended' | 'error', listener: () => void): void;
  removeEventListener(type: 'ended' | 'error', listener: () => void): void;
}

export interface ThemeMusicDeps {
  createAudio: () => ThemeAudio;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

const browserDeps: ThemeMusicDeps = {
  createAudio: () => new Audio(),
  setTimer: (callback, ms) => setInterval(callback, ms),
  clearTimer: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/**
 * Plays one theme at a time. The element is never attached to the page. A start stops the one
 * before; every start, retry and replay is a new generation, and an answer for an older generation
 * (a grant, a `play()` promise) is dropped, so nothing plays after a stop.
 */
export class ThemeMusicController {
  private generation = 0;
  private session = 0;
  private audio: ThemeAudio | null = null;
  private detach: (() => void) | null = null;
  private fade: unknown = null;

  constructor(private readonly deps: ThemeMusicDeps = browserDeps) {}

  /**
   * Starts a theme from its first second. `loop` is read when the song ends (or starts), so a
   * change of the setting meanwhile applies to the next end. Returns a stop that only stops this
   * start, not a newer one.
   */
  start(request: GrantRequest, loop: () => boolean): () => void {
    this.release();
    this.session += 1;
    const session = this.session;
    void this.run(request, loop, true);
    return () => {
      if (this.session === session) this.stop();
    };
  }

  /** Stops at once, without a fade, and gives the decoder back. */
  stop(): void {
    this.session += 1;
    this.release();
  }

  private release(): void {
    this.generation += 1;
    this.teardown();
  }

  private teardown(): void {
    if (this.fade !== null) this.deps.clearTimer(this.fade);
    this.fade = null;
    this.detach?.();
    this.detach = null;
    const audio = this.audio;
    this.audio = null;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }

  private async run(request: GrantRequest, loop: () => boolean, canRetry: boolean) {
    this.generation += 1;
    const generation = this.generation;
    this.teardown();
    let grant: ThemeGrant;
    try {
      grant = await request();
    } catch {
      return; // refused: silent until the page is shown again
    }
    if (generation !== this.generation) return;

    const audio = this.deps.createAudio();
    audio.volume = 0;
    // Only an original can seek back to its start in place; a converted one is progressive.
    audio.loop = loop() && grant.delivery === 'original';
    const onEnded = () => {
      if (generation !== this.generation) return;
      if (loop() && grant.delivery === 'converted') void this.run(request, loop, true);
    };
    const onError = () => {
      if (generation !== this.generation) return;
      if (canRetry) void this.run(request, loop, false);
      else this.release();
    };
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    this.detach = () => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
    this.audio = audio;
    audio.src = grant.url;
    try {
      await audio.play();
    } catch {
      if (generation === this.generation) this.release();
      return;
    }
    if (generation !== this.generation) return;
    this.fadeIn(audio, generation);
  }

  private fadeIn(audio: ThemeAudio, generation: number) {
    let step = 0;
    this.fade = this.deps.setTimer(() => {
      if (generation !== this.generation) return;
      step += 1;
      // Only the volume changes, and never past the target.
      audio.volume = Math.min(THEME_VOLUME, (THEME_VOLUME * step) / FADE_STEPS);
      if (step >= FADE_STEPS && this.fade !== null) {
        this.deps.clearTimer(this.fade);
        this.fade = null;
      }
    }, FADE_STEP_MS);
  }
}

/** The one controller of the app: exactly one theme element exists at a time. */
let controller = new ThemeMusicController();
let canPlayType: CanPlayType = elementCanPlayType;

export const themeMusic = {
  get controller() {
    return controller;
  },
  get canPlayType() {
    return canPlayType;
  },
};

/** Swaps the controller and the format probe for a test; `null` restores the real ones. */
export function setThemeMusicForTests(
  replacement: { controller?: ThemeMusicController; canPlayType?: CanPlayType } | null,
): void {
  controller.stop();
  controller = replacement?.controller ?? new ThemeMusicController();
  canPlayType = replacement?.canPlayType ?? elementCanPlayType;
}
