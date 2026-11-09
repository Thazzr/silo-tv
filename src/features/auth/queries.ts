import { useQuery } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { useSilo } from '../../app/SiloContext';

export type AuthProvider = components['schemas']['AuthProvider'];

/**
 * How this server lets people sign in. A failed request is not an error screen: without the
 * answer the sign-in screen simply offers the code only.
 */
export function useAuthProviders() {
  const { client, baseUrl } = useSilo();
  return useQuery({
    queryKey: ['authProviders', baseUrl],
    // A fresh answer every time a sign-in screen opens; the server may have changed its settings.
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/auth/providers');
      if (!data) throw toApiError(error, response);
      return data;
    },
  });
}

/** The providers that take a username and a password; the others (OAuth, network) are not used here. */
export function credentialProviders(items: AuthProvider[] | undefined): AuthProvider[] {
  return (items ?? []).filter((p) => p.mode === 'credentials');
}

/** The provider the picker starts on: the one the server marks as default, else the first. */
export function defaultProvider(providers: AuthProvider[]): AuthProvider | undefined {
  return providers.find((p) => p.default) ?? providers[0];
}
