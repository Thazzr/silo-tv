import { useMutation, useQuery } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { useSilo } from '../../app/SiloContext';

export type Profile = components['schemas']['Profile'];

export function useProfiles() {
  const { client, baseUrl, session } = useSilo();
  const userId = session.get()?.user?.id ?? '';
  return useQuery({
    queryKey: ['profiles', baseUrl, userId],
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/profiles');
      if (!data) throw toApiError(error, response);
      return data.items;
    },
  });
}

/** One PIN check. Never retried automatically: every attempt counts toward the lockout. */
export function useVerifyPin() {
  const { client } = useSilo();
  return useMutation({
    retry: false,
    mutationFn: async ({ id, pin }: { id: string; pin: string }) => {
      const { data, error, response } = await client.POST('/api/v2/profiles/{id}/verify-pin', {
        params: { path: { id } },
        body: { pin },
      });
      if (!data) throw toApiError(error, response);
      return data;
    },
  });
}
