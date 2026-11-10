// Test seam for the delay between unloading the video and ending the session on the server. It
// lives in a module of its own, without imports, so the test setup can use it without loading the
// playback controller before a test file has mocked what the controller imports.
export const stopTiming = {
  /** Overrides STOP_AFTER_UNLOAD_MS; undefined (production) keeps the real value. */
  delayMs: undefined as number | undefined,
  /** Stops that wait for their delay right now. */
  waiting: 0,
};
