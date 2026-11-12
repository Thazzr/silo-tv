// The card overlay badges ("1080p", "DV", "EAC3", "BluRay", ...) the profile chose to see on its
// cards: the registry of the ids Silo knows, the parser of the stored document
// (`ui.card_overlays`, version 2) and the layout rules. Pure functions; the settings reads are in
// `useCardBadges.ts`. The TV draws every document in one look, so presets, styles, icons and
// uploaded images in the document are ignored, and so is any id this registry does not draw.
import type { Language, MessageKey } from '../../i18n';
import { languageName } from '../../i18n/languages';
import type { CatalogItem } from './cardInfo';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * Where a badge sits on the art. The top-right corner is not one of them: the watch status lives
 * there, so no badge is ever placed in it.
 */
export type BadgePosition =
  'top-left' | 'bottom-left' | 'bottom-right' | 'left-edge' | 'right-edge';

export const BADGE_POSITIONS: readonly BadgePosition[] = [
  'top-left',
  'bottom-left',
  'bottom-right',
  'left-edge',
  'right-edge',
];

/** How many badges a corner and an edge rail hold; the rest are dropped. */
const CORNER_CAP = 3;
const EDGE_CAP = 4;

const capOf = (position: BadgePosition) =>
  position === 'left-edge' || position === 'right-edge' ? EDGE_CAP : CORNER_CAP;

interface BadgeContext {
  t: Translate;
  lang: Language;
}

interface BadgeDef {
  id: string;
  position: BadgePosition;
  enabled: boolean;
  /** The tint of the badge's fill; the document may override it with `accentColor`. */
  accent?: string;
  /** The badge's text for an item, or null when the item has no data for it. */
  text: (item: CatalogItem, context: BadgeContext) => string | null;
}

const nonEmpty = (value: string | undefined): string | null => (value?.trim() ? value : null);
const firstName = (names: string[] | undefined): string | null =>
  names?.map((name) => name.trim()).find(Boolean) ?? null;

/**
 * The web's resolution label: "2160p", "4k" and "uhd" are "4K", "4320p" and "8k" are "8K", a
 * number with a "p" is kept in lower case, anything else is upper-cased.
 */
function resolutionText(resolution: string | undefined): string | null {
  const trimmed = resolution?.trim();
  if (!trimmed) return null;
  const value = trimmed.toLowerCase();
  // "4k" and "8k" need no branch: upper-casing gives the same label.
  if (value === '2160p' || value === 'uhd') return '4K';
  if (value === '4320p') return '8K';
  if (/^\d+p$/.test(value)) return value;
  return trimmed.toUpperCase();
}

/** The dynamic range as the combined badges show it: any Dolby Vision is "DV", "HDR10+" stays, the rest is "HDR". */
function compactHdr(hdr: string | undefined): string | null {
  if (!hdr?.trim()) return null;
  if (hdr.includes('DV')) return 'DV';
  return hdr.includes('HDR10+') ? 'HDR10+' : 'HDR';
}

/** "1h 58m", or "45m" under an hour. */
function runtimeText(minutes: number | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
}

const outOfTen = (mark: string, score: number | undefined): string | null =>
  score === undefined ? null : `${mark} ${(Math.round(score * 10) / 10).toFixed(1)}`;
const percent = (mark: string, score: number | undefined): string | null =>
  score === undefined ? null : `${mark} ${Math.round(score)}%`;

const SHOW_STATUS_KEYS: Record<string, MessageKey> = {
  returning: 'card.status.returning',
  'returning series': 'card.status.returning',
  continuing: 'card.status.returning',
  in_production: 'card.status.returning',
  'in production': 'card.status.returning',
  ended: 'card.status.ended',
  cancelled: 'card.status.cancelled',
  canceled: 'card.status.cancelled',
  upcoming: 'card.status.upcoming',
  planned: 'card.status.upcoming',
};

/** The known statuses in the app's language, any other value as the server sent it. */
function showStatusText(status: string | undefined, t: Translate): string | null {
  const value = status?.trim();
  if (!value) return null;
  const key = Object.prototype.hasOwnProperty.call(SHOW_STATUS_KEYS, value.toLowerCase())
    ? SHOW_STATUS_KEYS[value.toLowerCase()]
    : undefined;
  return key ? t(key) : value;
}

/**
 * The ids the app draws, in the order Silo's web app lists them (the default order within a
 * position), with the web's default position and whether a profile without a document sees it.
 * The request status, the IMDb Top 250 and the Rotten Tomatoes certified-fresh ids are not here:
 * a library item has no request, and the other two have no data on either API shape yet.
 */
const REGISTRY: readonly BadgeDef[] = [
  {
    id: 'resolution',
    position: 'top-left',
    enabled: true,
    text: (item) => resolutionText(item.overlay_summary?.resolution),
  },
  {
    id: 'hdr',
    position: 'top-left',
    enabled: true,
    text: (item) => nonEmpty(item.overlay_summary?.hdr),
  },
  {
    id: 'resolution_hdr',
    position: 'top-left',
    enabled: false,
    text: (item) => {
      const resolution = resolutionText(item.overlay_summary?.resolution);
      if (!resolution) return null;
      const hdr = compactHdr(item.overlay_summary?.hdr);
      return hdr ? `${resolution} ${hdr}` : resolution;
    },
  },
  {
    id: 'resolution_hdr_audio',
    position: 'top-left',
    enabled: false,
    text: (item) =>
      [
        resolutionText(item.overlay_summary?.resolution),
        compactHdr(item.overlay_summary?.hdr),
        nonEmpty(item.overlay_summary?.audio),
      ]
        .filter(Boolean)
        .join(' ') || null,
  },
  {
    id: 'audio',
    position: 'top-left',
    enabled: true,
    text: (item) => nonEmpty(item.overlay_summary?.audio),
  },
  {
    id: 'audio_channels',
    position: 'top-left',
    enabled: false,
    text: (item) => nonEmpty(item.overlay_summary?.audio_channels),
  },
  {
    id: 'video_codec',
    position: 'top-left',
    enabled: false,
    text: (item) => nonEmpty(item.overlay_summary?.video_codec),
  },
  {
    id: 'container',
    position: 'bottom-left',
    enabled: false,
    text: (item) => nonEmpty(item.overlay_summary?.container),
  },
  {
    id: 'aspect_ratio',
    position: 'bottom-right',
    enabled: false,
    text: (item) => nonEmpty(item.overlay_summary?.aspect_ratio),
  },
  {
    id: 'release_type',
    position: 'bottom-left',
    enabled: true,
    text: (item) => nonEmpty(item.overlay_summary?.release_type),
  },
  {
    id: 'edition',
    position: 'bottom-left',
    enabled: false,
    text: (item) => nonEmpty(item.overlay_summary?.edition),
  },
  {
    id: 'multi_audio',
    position: 'bottom-right',
    enabled: false,
    text: (item, { t }) => (item.overlay_summary?.multi_audio ? t('card.badge.multiAudio') : null),
  },
  {
    id: 'multi_sub',
    position: 'bottom-right',
    enabled: false,
    text: (item) => (item.overlay_summary?.multi_sub ? 'CC' : null),
  },
  {
    id: 'rating_imdb',
    position: 'left-edge',
    enabled: false,
    accent: '#f5c518',
    text: (item) => outOfTen('IMDb', item.rating_imdb),
  },
  {
    id: 'rating_tmdb',
    position: 'left-edge',
    enabled: false,
    accent: '#01b4e4',
    text: (item) => outOfTen('TMDB', item.rating_tmdb),
  },
  {
    id: 'rating_rt',
    position: 'left-edge',
    enabled: false,
    accent: '#fa320a',
    text: (item) => percent('RT', item.rating_rt_critic),
  },
  {
    id: 'rating_rt_audience',
    position: 'left-edge',
    enabled: false,
    accent: '#fa6400',
    text: (item, { t }) => percent(t('card.badge.rtAudience'), item.rating_rt_audience),
  },
  {
    id: 'content_rating',
    position: 'bottom-right',
    enabled: false,
    text: (item) => nonEmpty(item.content_rating),
  },
  {
    id: 'advisory_age',
    position: 'bottom-right',
    enabled: false,
    text: (item) =>
      item.advisory_age !== undefined && item.advisory_age > 0 ? `${item.advisory_age}+` : null,
  },
  {
    id: 'year',
    position: 'bottom-left',
    enabled: false,
    text: (item) => ((item.year ?? 0) > 0 ? String(item.year) : null),
  },
  {
    id: 'runtime',
    position: 'bottom-left',
    enabled: false,
    text: (item) => runtimeText(item.runtime),
  },
  {
    id: 'original_language',
    position: 'bottom-left',
    enabled: false,
    text: (item, { lang }) => languageName(item.original_language, lang),
  },
  {
    id: 'studio',
    position: 'bottom-right',
    enabled: false,
    text: (item) => firstName(item.studios),
  },
  {
    id: 'network',
    position: 'bottom-right',
    enabled: false,
    text: (item) => firstName(item.networks),
  },
  {
    id: 'show_status',
    position: 'right-edge',
    enabled: false,
    text: (item, { t }) => showStatusText(item.show_status, t),
  },
];

/**
 * The generic glyphs a badge can carry, as the web's icon ids (Lucide icons). The web's brand
 * wordmarks (Dolby Vision, Atmos, HDR10, HDR, AV1) are not here: a badge that has one keeps its
 * text.
 */
export type BadgeGlyph =
  | 'monitor'
  | 'volume'
  | 'film'
  | 'layout'
  | 'languages'
  | 'subtitles'
  | 'shield'
  | 'users'
  | 'clock'
  | 'globe'
  | 'building'
  | 'tv';

/** The glyph of a badge id for an item; null where the web draws a wordmark or no icon at all. */
const GLYPHS: Record<string, BadgeGlyph | ((item: CatalogItem) => BadgeGlyph | null)> = {
  resolution: 'monitor',
  audio: (item) => (item.overlay_summary?.audio?.toLowerCase() === 'atmos' ? null : 'volume'),
  audio_channels: 'volume',
  video_codec: (item) => (item.overlay_summary?.video_codec === 'AV1' ? null : 'film'),
  aspect_ratio: 'layout',
  multi_audio: 'languages',
  multi_sub: 'subtitles',
  content_rating: 'shield',
  advisory_age: 'users',
  runtime: 'clock',
  original_language: 'globe',
  studio: 'building',
  network: 'tv',
  show_status: 'tv',
};

function glyphOf(id: string, item: CatalogItem): BadgeGlyph | null {
  const glyph = GLYPHS[id];
  return typeof glyph === 'function' ? glyph(item) : (glyph ?? null);
}

/** A combined badge hides the badges whose information it already shows, widest first. */
const COMBINED: readonly (readonly [string, readonly string[]])[] = [
  ['resolution_hdr_audio', ['resolution', 'hdr', 'audio', 'resolution_hdr']],
  ['resolution_hdr', ['resolution', 'hdr']],
];

/**
 * The web's presets that draw glyphs unless a badge says otherwise (its `preferIcon`); classic,
 * minimal, square and band, and any unknown or missing preset, do not. The TV draws every preset
 * in one look, so this is all it takes from a preset.
 */
const PRESETS_WITH_ICONS = ['vibrant', 'pill', 'plate'];

interface BadgeSetting {
  enabled: boolean;
  position: BadgePosition;
  accent?: string;
  /** Overrides the preset's preference for this badge. */
  showIcon?: boolean;
}

/** A complete document: every id of the registry has its setting. */
export interface BadgePrefs {
  /** The ids the document ranks, in its order; the rest follow in registry order. */
  order: readonly string[];
  /** Whether the document's preset draws glyphs on badges that do not say so themselves. */
  preferIcon: boolean;
  items: Readonly<Record<string, BadgeSetting>>;
}

const isPosition = (value: unknown): value is BadgePosition =>
  typeof value === 'string' && (BADGE_POSITIONS as readonly string[]).includes(value);

const isHexColour = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A document is version 2 when it says so, or has a preset and an items map; anything else is the
 * old flat map of id to setting.
 */
function itemsOf(document: Record<string, unknown>): Record<string, unknown> {
  const isV2 =
    document.version === 2 || (typeof document.preset === 'string' && isRecord(document.items));
  const items = isV2 ? document.items : document;
  return isRecord(items) ? items : {};
}

function settingOf(def: BadgeDef, stored: unknown): BadgeSetting {
  const setting: BadgeSetting = { enabled: def.enabled, position: def.position };
  if (def.accent) setting.accent = def.accent;
  if (!isRecord(stored)) return setting;
  if (typeof stored.enabled === 'boolean') setting.enabled = stored.enabled;
  // Documents written before the top-right held the watch status may still name it; the badge
  // moves to the rail on the same side.
  if (stored.position === 'top-right') setting.position = 'right-edge';
  else if (isPosition(stored.position)) setting.position = stored.position;
  if (isHexColour(stored.accentColor)) setting.accent = stored.accentColor;
  if (typeof stored.showIcon === 'boolean') setting.showIcon = stored.showIcon;
  return setting;
}

function documentOf(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(raw) ? raw : null;
}

/**
 * Reads a stored or server-default document (an object, or the same as a JSON string). Unknown
 * ids and fields are ignored and a missing or invalid field keeps the registry's default. Null
 * when there is no usable document, which means "no preference".
 */
export function parseBadgePrefs(raw: unknown): BadgePrefs | null {
  const document = documentOf(raw);
  if (document === null) return null;
  const stored = itemsOf(document);
  const items: Record<string, BadgeSetting> = {};
  for (const def of REGISTRY) {
    items[def.id] = settingOf(def, stored[def.id]);
  }
  const known = new Set(REGISTRY.map((def) => def.id));
  const order = Array.isArray(document.order)
    ? document.order.filter((id): id is string => typeof id === 'string' && known.has(id))
    : [];
  const preset = typeof document.preset === 'string' ? document.preset : 'classic';
  return { order, preferIcon: PRESETS_WITH_ICONS.includes(preset), items };
}

/** What a profile sees that has no preference and whose server has no default: the registry's own. */
export function defaultBadgePrefs(): BadgePrefs {
  return parseBadgePrefs({}) as BadgePrefs;
}

/**
 * The document the cards draw, or null for no badges at all. The profile's own document wins, then
 * the server's default document, then the registry's defaults. The two switches inherit the same
 * way: the profile's explicit choice, else the server's (`enabled !== false`).
 */
export function resolveBadgePrefs(input: {
  profileDocument: BadgePrefs | null;
  profileEnabled: boolean | null;
  serverDefaults: string | undefined;
  serverEnabled: boolean | undefined;
}): BadgePrefs | null {
  const enabled = input.profileEnabled ?? input.serverEnabled !== false;
  if (!enabled) return null;
  return input.profileDocument ?? parseBadgePrefs(input.serverDefaults) ?? defaultBadgePrefs();
}

export interface Badge {
  id: string;
  text: string;
  accent?: string;
  /** The generic glyph drawn before the text; only when the document asks for it. */
  glyph?: BadgeGlyph;
}

export type CardBadges = Record<BadgePosition, Badge[]>;

/**
 * The badges an item shows in each position: the enabled ones that have data for the item, a
 * combined badge in place of the ones it covers, ranked by the document's order, cut to what a
 * corner or an edge rail holds.
 */
export function cardBadges(
  item: CatalogItem,
  prefs: BadgePrefs,
  context: BadgeContext,
): CardBadges {
  const result: CardBadges = {
    'top-left': [],
    'bottom-left': [],
    'bottom-right': [],
    'left-edge': [],
    'right-edge': [],
  };
  const covered = new Set<string>();
  for (const [combined, covers] of COMBINED) {
    if (prefs.items[combined]?.enabled) covers.forEach((id) => covered.add(id));
  }
  const rank = new Map(prefs.order.map((id, index) => [id, index]));
  // The sort is stable, so badges the document does not rank keep the registry's order.
  const ranked = REGISTRY.filter(
    (def) => prefs.items[def.id]?.enabled && !covered.has(def.id),
  ).sort((a, b) => (rank.get(a.id) ?? REGISTRY.length) - (rank.get(b.id) ?? REGISTRY.length));
  for (const def of ranked) {
    const setting = prefs.items[def.id]!;
    const stack = result[setting.position];
    const text = def.text(item, context);
    if (text === null || stack.length >= capOf(setting.position)) continue;
    const glyph = (setting.showIcon ?? prefs.preferIcon) ? glyphOf(def.id, item) : null;
    stack.push({
      id: def.id,
      text,
      ...(setting.accent ? { accent: setting.accent } : {}),
      ...(glyph ? { glyph } : {}),
    });
  }
  return result;
}

/** The rating sources of an item in the order the badges list them: the first with a score is shown alone. */
const RATING_IDS = ['rating_imdb', 'rating_tmdb', 'rating_rt', 'rating_rt_audience'] as const;

/**
 * The one rating a text line shows ("TMDB 7.0"): the first source the item has a score for, as
 * text. The server only sends the sources the administrator shows.
 */
export function primaryRatingText(item: CatalogItem, context: BadgeContext): string | null {
  for (const id of RATING_IDS) {
    const text = REGISTRY.find((def) => def.id === id)?.text(item, context);
    if (text) return text;
  }
  return null;
}
