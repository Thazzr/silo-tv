import { isValidYouTubeVideoId, type OpenYouTubeResult } from '../shared/youtube';
import { lunaCall } from './luna';

/**
 * Hands a YouTube video to the TV's own YouTube app. Nothing is fetched from Google by this app.
 *
 * UNVERIFIED on hardware: the TV test must confirm the app id (`youtube.leanback.v4`) and the form
 * of `contentTarget` on each webOS version. Once confirmed, `requiredACG` in appinfo.json must
 * gain the permission group of the application-manager launch call (CLAUDE.md keeps the field out
 * until the probe has shown which Luna calls stay).
 */
export async function openYouTubeVideo(videoId: string): Promise<OpenYouTubeResult> {
  if (!isValidYouTubeVideoId(videoId)) return 'unavailable';
  try {
    await lunaCall('luna://com.webos.applicationManager/launch', {
      id: 'youtube.leanback.v4',
      params: { contentTarget: `https://www.youtube.com/tv?v=${videoId}` },
    });
    return 'opened';
  } catch {
    return 'unavailable';
  }
}
