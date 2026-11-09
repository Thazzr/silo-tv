// Shared setup of the spoiler-protection component tests: a signed-in profile (the settings are
// read per profile) and a gate that holds the settings answers back.
import { act } from '@testing-library/react';
import { Session } from '../api/session';
import { account } from './apiFixtures';
import { memoryStorage } from './renderFlow';

export function signedInSession(): Session {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  return session;
}

/** Both spoiler settings, as the server's stored values. */
export const spoilerValues = (images: boolean, overviews: boolean) => ({
  'catalog.hide_unwatched_episode_images': images,
  'catalog.hide_unwatched_episode_overviews': overviews,
});

export function holdAnswers() {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const release = () =>
    act(async () => {
      open();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  return { gate, release };
}
