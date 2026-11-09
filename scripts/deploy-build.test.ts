import { describe, expect, it } from 'vitest';
import { resolveBuild } from './deploy-build.mjs';

describe('resolveBuild', () => {
  it('uses the normal build in dist by default', () => {
    expect(resolveBuild({})).toEqual({ perf: false, viteArgs: ['build'], distDir: 'dist' });
  });

  it('PERF_BUILD=1 builds in perf mode and ships dist-perf', () => {
    expect(resolveBuild({ PERF_BUILD: '1' })).toEqual({
      perf: true,
      viteArgs: ['build', '--mode', 'perf'],
      distDir: 'dist-perf',
    });
  });

  it.each(['0', 'false', 'no', 'off', '', '  '])('PERF_BUILD=%j stays the normal build', (v) => {
    expect(resolveBuild({ PERF_BUILD: v }).distDir).toBe('dist');
  });
});
