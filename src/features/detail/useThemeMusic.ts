import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import { useSilo } from '../../app/SiloContext';
import { useProfileSettings } from '../settings/profileSettings';
import type { ItemDetail } from './info';
import { firstTheme, requestThemeGrant, themeMusic } from './themeMusic';

const ONE_MINUTE = 60 * 1000;

/** Whether the server offers theme music to this profile; a failed read counts as "no". */
function useThemeCapability(enabled: boolean) {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  return useQuery({
    queryKey: ['themes', 'capability', baseUrl, profileId],
    enabled: enabled && profileId !== '',
    staleTime: ONE_MINUTE,
    retry: false,
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/catalog/themes/capabilities', {
        params: { header: { 'X-Profile-Id': profileId } },
      });
      if (!data) throw toApiError(error, response);
      return data.state === 'available' && data.allowed !== false;
    },
  });
}

const documentVisible = () => document.visibilityState !== 'hidden';

/**
 * Plays the item's theme song while the calling page is mounted, when the profile turns theme
 * music on and the server offers it. The page's lifetime is the music's lifetime: the navigator
 * mounts only the screen on top, so a screen pushed over the page, Back, a profile switch and a
 * sign-out all unmount it and stop the music at once. A page that goes to the background stops
 * it too, and starts it again from the beginning when it comes back.
 */
export function useThemeMusic(detail: ItemDetail): void {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  const { values, known } = useProfileSettings();
  const wanted = known && values['ui.theme_music_enabled'];
  const capability = useThemeCapability(wanted);
  const theme = firstTheme(detail.themes);
  const ownerId = theme?.ownerId;
  const themeId = theme?.themeId;
  const plays =
    wanted && capability.data === true && ownerId !== undefined && themeId !== undefined;

  const [visible, setVisible] = useState(documentVisible);
  useEffect(() => {
    const onChange = () => setVisible(documentVisible());
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  // Read when a song ends, so toggling the loop setting meanwhile applies to the next end.
  const loopRef = useRef(false);
  const loop = values['ui.theme_music_loop'];
  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  useEffect(() => {
    if (!plays || !visible || ownerId === undefined || themeId === undefined) return;
    // The grant is a credential: it only goes from the response to the audio element.
    return themeMusic.controller.start(
      () =>
        requestThemeGrant(client, baseUrl, profileId, { ownerId, themeId }, themeMusic.canPlayType),
      () => loopRef.current,
    );
  }, [plays, visible, ownerId, themeId, client, baseUrl, profileId]);
}
