// A YouTube video id as the server reports it (`site_key` of a remote video). The adapters build a
// URL from it, so nothing else than a plain id may get that far.
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

export function isValidYouTubeVideoId(id: unknown): id is string {
  return typeof id === 'string' && YOUTUBE_VIDEO_ID.test(id);
}

/** What `Platform.openYouTubeVideo` answers: the TV's YouTube app took over, or it could not. */
export type OpenYouTubeResult = 'opened' | 'unavailable';
