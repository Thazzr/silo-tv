// The badge document a card draws: the profile's `ui.card_overlays` and `ui.card_overlays_enabled`
// over the server's defaults (`GET /api/v2/settings/overlay-config`).
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import { useSilo } from '../../app/SiloContext';
import { useProfileSettings } from '../../features/settings/profileSettings';
import { resolveBadgePrefs, type BadgePrefs } from './badges';

const ONE_MINUTE = 60 * 1000;

/**
 * The badges the cards draw, or null for none: while the profile's settings or the server's
 * defaults are still being read (so no badge flashes up and vanishes), when there is no profile,
 * and when the profile or the server switched them off. A failed read of the defaults leaves the
 * registry's own, like a server without any.
 */
export function useCardBadgePrefs(): BadgePrefs | null {
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
  return useMemo(
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
}
