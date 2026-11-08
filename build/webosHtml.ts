import type { Plugin } from 'vite';

/**
 * An installed webOS app runs under file://, where module scripts and crossorigin loads are
 * blocked. Rewrite the emitted HTML into a classic deferred script without crossorigin.
 */
export function transformWebosHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>/g, (tag) => {
      let out = tag
        .replace(/\s+type=(["'])module\1/g, '')
        .replace(/\s+crossorigin(?:=(["'])[^"']*\1)?/g, '');
      if (/\ssrc=/.test(out) && !/\sdefer\b/.test(out)) {
        out = out.replace(/^<script/, '<script defer');
      }
      return out;
    })
    .replace(/<link\b[^>]*>/g, (tag) => tag.replace(/\s+crossorigin(?:=(["'])[^"']*\1)?/g, ''));
}

export function webosHtml(): Plugin {
  return {
    name: 'webos-html',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler: transformWebosHtml,
    },
  };
}
