import { describe, expect, it } from 'vitest';
import { transformWebosHtml } from './webosHtml';

const viteHtml = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <script type="module" crossorigin src="./assets/x.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/x.css">
  </head>
  <body><div id="root"></div></body>
</html>`;

describe('transformWebosHtml', () => {
  it('turns the module script into a classic deferred script and drops crossorigin', () => {
    const out = transformWebosHtml(viteHtml);
    expect(out).not.toContain('type="module"');
    expect(out).not.toContain('crossorigin');
    expect(out).toContain('<script defer src="./assets/x.js"></script>');
    expect(out).toContain('<link rel="stylesheet" href="./assets/x.css">');
  });

  it('leaves already clean html unchanged', () => {
    const clean = `<html><head><script defer src="./a.js"></script><link rel="stylesheet" href="./a.css"></head></html>`;
    expect(transformWebosHtml(clean)).toBe(clean);
  });

  it('does not add defer to inline scripts', () => {
    const inline = '<script>window.x = 1;</script>';
    expect(transformWebosHtml(inline)).toBe(inline);
  });
});
