// Which build tv-deploy.mjs ships. PERF_BUILD=1 selects the profiling build (readable function
// names for CPU profiles, see vite.config.ts "perf" mode) in dist-perf/; same app ID, so it
// replaces the installed app. Everything else uses the normal build in dist/.
export function resolveBuild(env) {
  const flag = env.PERF_BUILD?.trim().toLowerCase();
  const perf = Boolean(flag) && !['0', 'false', 'no', 'off'].includes(flag);
  return perf
    ? { perf: true, viteArgs: ['build', '--mode', 'perf'], distDir: 'dist-perf' }
    : { perf: false, viteArgs: ['build'], distDir: 'dist' };
}
