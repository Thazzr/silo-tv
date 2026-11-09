import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import { useSilo } from '../../app/SiloContext';
import { resolveSheetUrl, type TrickplayManifest } from './previewMath';

/** A manifest is read again this often at the earliest, whatever its expiry says (clock skew). */
const MIN_REFRESH_MS = 5_000;
/** ...and at the latest after this long: a timer beyond ~24 days overflows and fires at once. */
const MAX_REFRESH_MS = 6 * 60 * 60 * 1000;

export const trickplayKey = (
  baseUrl: string,
  profileId: string,
  contentId: string,
  fileId: string,
) => ['playback', 'trickplay', baseUrl, profileId, contentId, fileId] as const;

/** A manifest with its sheet URLs resolved, by sheet index (null: unusable URL). */
export interface TrickplayImages {
  manifest: TrickplayManifest;
  sheetUrls: (string | null)[];
}

/**
 * The scrub-preview manifest of the playing file: read once, and again when its signed sheet URLs
 * expire. Idle (no request) unless `enabled`, which is the caller's two gates: the server offers
 * trickplay and this file's version has it. A failed read leaves `data` undefined: the card then
 * shows no image and nothing else changes.
 */
export function useTrickplay(
  contentId: string,
  fileId: string,
  enabled: boolean,
): TrickplayImages | undefined {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  const query = useQuery({
    queryKey: trickplayKey(baseUrl, profileId, contentId, fileId),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (q) => {
      const expires = q.state.data ? Date.parse(q.state.data.expires_at) : NaN;
      if (!Number.isFinite(expires)) return false;
      return Math.min(MAX_REFRESH_MS, Math.max(MIN_REFRESH_MS, expires - Date.now()));
    },
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/watch/{id}/trickplay', {
        params: {
          header: { 'X-Profile-Id': profileId },
          path: { id: contentId },
          query: { file_id: fileId },
        },
      });
      if (!data) throw toApiError(error, response);
      return data;
    },
  });
  const manifest = enabled ? query.data : undefined;
  return useMemo(() => {
    if (!manifest) return undefined;
    const sheetUrls: (string | null)[] = [];
    for (const sheet of manifest.sheets)
      sheetUrls[sheet.index] = resolveSheetUrl(sheet.url, baseUrl);
    return { manifest, sheetUrls };
  }, [manifest, baseUrl]);
}
