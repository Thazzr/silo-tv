import { useState } from 'react';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../api/generated/schema';
import { Session } from '../../api/session';
import { BASE_URL, account } from '../../test/apiFixtures';
import { fakeVideo, installFakeMedia } from '../../test/fakeVideo';
import {
  ACCESS_TOKEN,
  SESSION_ID,
  playableDecision,
  playbackPlan,
  servePlayback,
} from '../../test/playbackFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { serveSettings } from '../../test/settingsFixtures';
import { PlayerScreen } from '../PlayerScreen';
import { PlayerSubtitles } from './SubtitleOverlay';
import { clearInstallationCache } from '../session/startSession';

type Plan = components['schemas']['PlaybackPlan'];
type Subtitle = components['schemas']['SubtitleDecisionV3'];

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

let restoreMedia: () => void;
beforeEach(() => {
  window.localStorage.clear();
  clearInstallationCache();
  restoreMedia = installFakeMedia();
});
afterEach(async () => {
  restoreMedia();
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 30));
  server.resetHandlers();
});

const SUBTITLE_URL = `/api/v2/stream/${SESSION_ID}/subtitles/0.vtt?file_id=file-1`;
const VTT = [
  'WEBVTT',
  '',
  '00:00:10.000 --> 00:00:12.000',
  'Early cue',
  '',
  '00:10:05.000 --> 00:10:07.000',
  'Shifted cue',
].join('\n');
const VTT_B = 'WEBVTT\n\n00:00:10.000 --> 00:00:12.000\nSecond track';

function sidecar(over: Partial<Subtitle> = {}): Subtitle {
  return {
    mode: 'render',
    inventory: [],
    artifact: {
      url: SUBTITLE_URL,
      mime_type: 'text/vtt',
      format: 'vtt',
      timing_origin_seconds: 0,
    },
    ...over,
  };
}

function plan(subtitle: Subtitle, over: Partial<Plan> = {}): Plan {
  return playbackPlan({ subtitle, ...over });
}

function signedIn() {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: ACCESS_TOKEN,
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  return session;
}

/** Serves the subtitle URL and records each request's URL. */
function serveSidecar(body = VTT, status = 200) {
  const urls: string[] = [];
  server.use(
    http.get(`${BASE_URL}/api/v2/stream/${SESSION_ID}/subtitles/:name`, ({ request }) => {
      urls.push(request.url);
      return new HttpResponse(body, { status, headers: { 'content-type': 'text/vtt' } });
    }),
  );
  return urls;
}

async function playing(start: Plan, values: Record<string, unknown> = {}) {
  servePlayback(server, { start: [playableDecision(start)] });
  serveSettings(server, { values });
  const view = renderWithSilo(
    <PlayerScreen
      contentId="m1"
      title="First Title"
      intent={{ kind: 'beginning' }}
      onExit={vi.fn()}
    />,
    { session: signedIn() },
  );
  await screen.findByTestId('player');
  const video = view.container.querySelector('video')!;
  fireEvent.playing(video);
  const state = fakeVideo(video);
  const at = (seconds: number) => {
    state.currentTime = seconds;
    fireEvent.timeUpdate(video);
  };
  return { ...view, video, state, at };
}

describe('Player subtitles', () => {
  it('shows the cue of the source time, fetched with the token on the server origin', async () => {
    const urls = serveSidecar();
    const { at } = await playing(plan(sidecar()));
    await waitFor(() => expect(urls).toHaveLength(1));
    expect(urls[0]).toBe(`${BASE_URL}${SUBTITLE_URL}&token=${ACCESS_TOKEN}`);

    at(5);
    expect(screen.queryByTestId('player-subtitles')).not.toBeInTheDocument();
    at(11);
    expect(await screen.findByText('Early cue')).toBeInTheDocument();
    // The cue ends at 12 s (exclusive).
    at(12);
    expect(screen.queryByText('Early cue')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(ACCESS_TOKEN);
  });

  it('measures cues on the source timeline: the timeline offset is added to the player time', async () => {
    serveSidecar();
    const { at } = await playing(
      plan(sidecar(), {
        timeline: {
          can_seek_anywhere: true,
          player_start_seconds: 0,
          seek_restoration: 'player_position',
          source_start_seconds: 0,
          stream_origin_seconds: 0,
          timeline_offset_seconds: 600,
        },
      }),
    );
    // Player time 6 s is source time 606 s.
    at(6);
    expect(await screen.findByText('Shifted cue')).toBeInTheDocument();
    at(11);
    expect(screen.queryByText('Early cue')).not.toBeInTheDocument();
    expect(screen.queryByText('Shifted cue')).not.toBeInTheDocument();
  });

  it('draws nothing, and fetches nothing, for burn-in or no subtitle', async () => {
    const urls = serveSidecar();
    const burn = await playing(plan(sidecar({ mode: 'burn_in', artifact: undefined })));
    burn.at(11);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId('player-subtitles')).not.toBeInTheDocument();
    expect(urls).toHaveLength(0);
    cleanup();

    const off = await playing(plan({ mode: 'off', inventory: [] }));
    off.at(11);
    expect(screen.queryByTestId('player-subtitles')).not.toBeInTheDocument();
    expect(urls).toHaveLength(0);
  });

  it('shows no error and no cues when the fetch fails', async () => {
    const urls = serveSidecar('gone', 404);
    const { at } = await playing(plan(sidecar()));
    await waitFor(() => expect(urls).toHaveLength(1));
    at(11);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId('player-subtitles')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('follows the profile appearance', async () => {
    serveSidecar();
    const { at } = await playing(plan(sidecar()), {
      'playback.subtitle_appearance': { fontSize: 'xxlarge', position: 'top' },
    });
    at(11);
    // The profile's values arrive after the first render; the default size applies until then.
    await waitFor(() =>
      expect(screen.getByText('Early cue').closest('p')!.style.fontSize).toBe('72px'),
    );
    expect(screen.getByTestId('player-subtitles')).toHaveAttribute('data-position', 'top');
  });

  it('lifts the subtitles above the controls while the overlay is open', async () => {
    serveSidecar();
    const { at } = await playing(plan(sidecar()));
    at(11);
    await screen.findByText('Early cue');
    expect(screen.getByTestId('player-subtitles')).toHaveAttribute('data-lifted', 'false');
    // The first key opens the overlay.
    fireEvent.keyDown(window, { keyCode: 13 });
    await waitFor(() =>
      expect(screen.getByTestId('player-subtitles')).toHaveAttribute('data-lifted', 'true'),
    );
    expect(screen.getByTestId('player-subtitles').style.transform).toContain('translateY');
  });

  it('loads the cues of the new subtitle when a replan names another artifact', async () => {
    const urls: string[] = [];
    server.use(
      http.get(`${BASE_URL}/api/v2/stream/${SESSION_ID}/subtitles/:name`, ({ params }) => {
        urls.push(String(params.name));
        return new HttpResponse(params.name === '1.vtt' ? VTT_B : VTT, { status: 200 });
      }),
    );
    const first = plan(sidecar());
    const second = plan(
      sidecar({
        artifact: {
          url: `/api/v2/stream/${SESSION_ID}/subtitles/1.vtt?file_id=file-1`,
          mime_type: 'text/vtt',
          format: 'vtt',
          timing_origin_seconds: 0,
        },
      }),
      { plan_id: 'plan:2', plan_attempt_key: 'v3:key-2' },
    );
    servePlayback(server, {
      start: [playableDecision(first)],
      replan: [playableDecision(second)],
    });
    serveSettings(server);
    const view = renderWithSilo(
      <PlayerScreen
        contentId="m1"
        title="First Title"
        intent={{ kind: 'beginning' }}
        onExit={vi.fn()}
      />,
      { session: signedIn() },
    );
    await screen.findByTestId('player');
    const video = view.container.querySelector('video')!;
    fireEvent.playing(video);
    const state = fakeVideo(video);
    state.currentTime = 11;
    fireEvent.timeUpdate(video);
    expect(await screen.findByText('Early cue')).toBeInTheDocument();

    // A media error makes the controller replan; the new plan carries the other subtitle.
    state.error = { code: 3, message: 'decode' };
    fireEvent.error(video);
    await waitFor(() => expect(urls).toContain('1.vtt'));
    const next = view.container.querySelector('video')!;
    fireEvent.playing(next);
    const nextState = fakeVideo(next);
    nextState.currentTime = 11;
    fireEvent.timeUpdate(next);
    expect(await screen.findByText('Second track')).toBeInTheDocument();
    expect(screen.queryByText('Early cue')).not.toBeInTheDocument();
  });

  it('shows no subtitle block while the new artifact loads, never the old cues', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${BASE_URL}/api/v2/stream/${SESSION_ID}/subtitles/:name`, async ({ params }) => {
        if (params.name === '1.vtt') {
          await held;
          return new HttpResponse(VTT_B, { status: 200 });
        }
        return new HttpResponse(VTT, { status: 200 });
      }),
    );
    const first = plan(sidecar());
    const second = plan(
      sidecar({
        artifact: {
          url: `/api/v2/stream/${SESSION_ID}/subtitles/1.vtt?file_id=file-1`,
          mime_type: 'text/vtt',
          format: 'vtt',
          timing_origin_seconds: 0,
        },
      }),
    );
    // A new plan reaches the same mounted subtitles, as a track change without a reload does.
    function Probe() {
      const [current, setCurrent] = useState(first);
      return (
        <>
          <button onClick={() => setCurrent(second)}>switch</button>
          <PlayerSubtitles plan={current} position={11} lifted={false} />
        </>
      );
    }
    serveSettings(server);
    renderWithSilo(<Probe />, { session: signedIn() });
    expect(await screen.findByText('Early cue')).toBeInTheDocument();

    fireEvent.click(screen.getByText('switch'));
    expect(screen.queryByText('Early cue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('player-subtitles')).not.toBeInTheDocument();

    release();
    expect(await screen.findByText('Second track')).toBeInTheDocument();
    expect(screen.queryByText('Early cue')).not.toBeInTheDocument();
  });
});
