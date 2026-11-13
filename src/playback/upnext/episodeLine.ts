import type { MessageKey } from '../../i18n';
import type { EpisodeRef } from '../episodes/neighbours';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** "S2:F4 — Title", as the web names the next episode; the code alone for an episode without a title. */
export function episodeLine(
  episode: Pick<EpisodeRef, 'seasonNumber' | 'episodeNumber' | 'title'>,
  t: Translate,
) {
  const code = t('player.upNext.code', {
    season: episode.seasonNumber,
    episode: episode.episodeNumber,
  });
  const title = episode.title.trim();
  return title === '' ? code : `${code} — ${title}`;
}
