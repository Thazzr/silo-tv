import { useCallback } from 'react';
import { useSilo } from '../../app/SiloContext';
import { resolveAssetUrl } from '../../features/branding/branding';

/**
 * Turns the image reference of a catalog item into a URL against the server it came from. The
 * reference is opaque (it is signed); it is only resolved, never built or changed.
 */
export function useMediaUrl(): (reference: string | undefined) => string | null {
  const { baseUrl } = useSilo();
  return useCallback((reference) => resolveAssetUrl(baseUrl, reference), [baseUrl]);
}
