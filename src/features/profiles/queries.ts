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

/**
 * Creates a household profile. Silo lets only the primary profile do that, so the request names
 * it (`X-Profile-Id`, and `X-Profile-Token` when it has a PIN) without opening it. Never retried:
 * a request without an answer may have created the profile, so the caller reads the list again.
 */
export function useCreateProfile() {
  const { client } = useSilo();
  return useMutation({
    retry: false,
    mutationFn: async ({
      primaryId,
      primaryToken,
      name,
      pin,
      isChild,
    }: {
      primaryId: string;
      primaryToken?: string;
      name: string;
      pin?: string;
      isChild: boolean;
    }) => {
      const { data, error, response } = await client.POST('/api/v2/profiles', {
        params: {
          header: {
            'X-Profile-Id': primaryId,
            ...(primaryToken ? { 'X-Profile-Token': primaryToken } : {}),
          },
        },
        body: { name, is_child: isChild, ...(pin ? { pin } : {}) },
      });
      if (!data) throw toApiError(error, response);
      return data;
    },
  });
}

/** The household's primary profile (or an only profile): the one that may create profiles. */
export function primaryProfile(items: Profile[] | undefined): Profile | undefined {
  if (!items) return undefined;
  return items.find((p) => p.is_primary) ?? (items.length === 1 ? items[0] : undefined);
}
