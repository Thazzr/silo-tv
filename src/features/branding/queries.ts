import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { useSilo } from '../../app/SiloContext';
import { hostOf, resolveAssetUrl, usableAccent } from './branding';

export type BrandingDocument = components['schemas']['BrandingConfiguration'];

/** What the screens use: names always present, images resolved or null, accent already vetted. */
export interface Branding {
  serverName: string;
  subtitle: string;
  markUrl: string | null;
  wordmarkUrl: string | null;
  backgroundUrl: string | null;
  accent: string | null;
}

/** The view of a server's branding; without a document (not loaded, failed) it is the plain fallback. */
export function brandingView(baseUrl: string, document?: BrandingDocument): Branding {
  return {
    // A server that sends something else than the documented shape still gets the fallback.
    serverName: (document?.server_name ?? '').trim() || hostOf(baseUrl),
    subtitle: (document?.login_subtitle ?? '').trim(),
    markUrl: resolveAssetUrl(baseUrl, document?.mark_url),
    wordmarkUrl: resolveAssetUrl(baseUrl, document?.wordmark_url),
    backgroundUrl: resolveAssetUrl(baseUrl, document?.login_bg_url),
    accent: usableAccent(document?.accent_color),
  };
}

const ONE_HOUR = 60 * 60 * 1000;

/**
 * The server's branding. It is decoration: a failed request is not retried and the screens fall
 * back to the host and a neutral badge without saying anything.
 */
export function useBranding(): Branding {
  const { client, baseUrl } = useSilo();
  const query = useQuery({
    queryKey: ['branding', baseUrl],
    staleTime: ONE_HOUR,
    retry: false,
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/theme/branding');
      if (!data) throw toApiError(error, response);
      return data;
    },
  });
  const document = query.data;
  return useMemo(() => brandingView(baseUrl, document), [baseUrl, document]);
}
