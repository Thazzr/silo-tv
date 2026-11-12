// The profile's preferences that every card reads: the badges it draws (the profile's
// `ui.card_overlays` and `ui.card_overlays_enabled` over the server's defaults,
// `GET /api/v2/settings/overlay-config`) and the spoiler protection. They are read once, by the
// provider above the screens, and handed down by context: a card that subscribed to the settings
// and a query itself would cost every card of every row that mounts a handful of observers.
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import { useSilo } from '../../app/SiloContext';
import { useProfileSettings } from '../../features/settings/profileSettings';
import { resolveBadgePrefs, type BadgePrefs } from './badges';
import type { SpoilerSettings } from './spoilers';

const ONE_MINUTE = 60 * 1000;

interface CardPrefs {
  badges: BadgePrefs | null;
  spoilers: SpoilerSettings;
}

const CardPrefsContext = createContext<CardPrefs | null>(null);

/**
 * The badges the cards draw are null for none: while the profile's settings or the server's
 * defaults are still being read (so no badge flashes up and vanishes), when there is no profile,
 * and when the profile or the server switched them off. A failed read of the defaults leaves the
 * registry's own, like a server without any. The spoiler settings count as off until the server
 * has answered, and when it cannot: the registry default of both keys is off.
 */
function useCardPrefsValue(): CardPrefs {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  const { values, known } = useProfileSettings();
  const config = useQuery({
    queryKey: ['settings', 'overlay-config', baseUrl, profileId],
    enabled: profileId !== '',
    staleTime: ONE_MINUTE,
    retry: false,
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/settings/overlay-config', {});
      if (!data) throw toApiError(error, response);
      return data;
    },
  });
  // Without a profile the defaults query is disabled and stays pending, so nothing is drawn.
  const settled = known && !config.isPending;
  const document = values['ui.card_overlays'];
  const enabled = values['ui.card_overlays_enabled'];
  const defaults = config.data?.defaults;
  const serverEnabled = config.data?.enabled;
  const images = values['catalog.hide_unwatched_episode_images'];
  const overviews = values['catalog.hide_unwatched_episode_overviews'];
  const badges = useMemo(
    () =>
      settled
        ? resolveBadgePrefs({
            profileDocument: document,
            profileEnabled: enabled,
            serverDefaults: defaults,
            serverEnabled,
          })
        : null,
    [settled, document, enabled, defaults, serverEnabled],
  );
  // Apart from the badges: a card's art and prefetch follow this object, and the badges' defaults
  // arriving must not make them start over.
  const spoilers = useMemo(() => ({ images, overviews }), [images, overviews]);
  return useMemo(() => ({ badges, spoilers }), [badges, spoilers]);
}

/** Reads the preferences once for everything below it; it needs the Silo and Query providers. */
export function CardPrefsProvider({ children }: { children: ReactNode }) {
  return (
    <CardPrefsContext.Provider value={useCardPrefsValue()}>{children}</CardPrefsContext.Provider>
  );
}

function useCardPrefs(): CardPrefs {
  const value = useContext(CardPrefsContext);
  if (!value) throw new Error('card preferences need a CardPrefsProvider');
  return value;
}

/** The badges the cards draw, or null for none (see `useCardPrefsValue`). */
export function useCardBadgePrefs(): BadgePrefs | null {
  return useCardPrefs().badges;
}

/** Both spoiler settings, live. */
export function useSpoilerSettings(): SpoilerSettings {
  return useCardPrefs().spoilers;
}
