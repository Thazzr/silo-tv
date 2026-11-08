import { describe, expect, it } from 'vitest';
import {
  checkDistFiles,
  checkHtml,
  checkNoServiceTests,
  checkServiceIds,
  checkVersions,
  serviceSourceFiles,
} from './bundle-checks.mjs';

const goodHtml =
  '<html><head><script defer src="./assets/index-a.js"></script>' +
  '<link rel="stylesheet" href="./assets/index-a.css"></head><body></body></html>';

describe('checkHtml', () => {
  it('accepts a classic deferred script with relative paths', () => {
    expect(checkHtml(goodHtml)).toEqual([]);
  });

  it('rejects type="module"', () => {
    const html = goodHtml.replace('<script defer', '<script type="module" defer');
    expect(checkHtml(html).join('\n')).toContain('type="module"');
  });

  it('rejects crossorigin', () => {
    const html = goodHtml.replace('<link ', '<link crossorigin ');
    expect(checkHtml(html).join('\n')).toContain('crossorigin');
  });

  it('rejects absolute and remote script/link references', () => {
    const absoluteScript = goodHtml.replace('"./assets/index-a.js"', '"/assets/index-a.js"');
    const absoluteLink = goodHtml.replace('"./assets/index-a.css"', '"/assets/a.css"');
    const remoteScript = goodHtml.replace('"./assets/index-a.js"', '"https://cdn.example/a.js"');
    expect(checkHtml(absoluteScript)).toHaveLength(1);
    expect(checkHtml(absoluteLink)).toHaveLength(1);
    expect(checkHtml(remoteScript)).toHaveLength(1);
  });

  it('rejects a script without defer', () => {
    const html = goodHtml.replace('<script defer', '<script');
    expect(checkHtml(html).join('\n')).toContain('defer');
  });
});

describe('checkDistFiles', () => {
  const files = ['index.html', 'appinfo.json', 'icon.png', 'largeIcon.png', 'assets/index-a.js'];

  it('accepts a complete dist with one js file', () => {
    expect(checkDistFiles(files)).toEqual([]);
  });

  it.each(['appinfo.json', 'icon.png', 'largeIcon.png'])('reports missing %s', (missing) => {
    expect(checkDistFiles(files.filter((f) => f !== missing)).join('\n')).toContain(missing);
  });

  it('rejects additional js chunks', () => {
    expect(checkDistFiles([...files, 'assets/chunk-b.js']).join('\n')).toContain('exactly one');
  });

  it('rejects a dist without any js file', () => {
    const withoutJs = files.filter((f) => !f.endsWith('.js'));
    expect(checkDistFiles(withoutJs).join('\n')).toContain('exactly one');
  });
});

describe('checkVersions', () => {
  it('accepts equal versions', () => {
    expect(checkVersions('0.0.1', '0.0.1')).toEqual([]);
  });

  it('rejects differing versions', () => {
    expect(checkVersions('0.0.2', '0.0.1').join('\n')).toContain('0.0.2');
  });
});

describe('checkServiceIds', () => {
  const services = {
    id: 'io.example.app.service',
    services: [{ name: 'io.example.app.service' }],
  };
  const pkg = { name: 'io.example.app.service' };

  it('accepts matching ids', () => {
    expect(checkServiceIds('io.example.app', services, pkg)).toEqual([]);
  });

  it('rejects a services.json id that differs from the app id', () => {
    expect(checkServiceIds('io.example.other', services, pkg).join('\n')).toContain(
      'services.json id',
    );
  });

  it('rejects a wrong service name', () => {
    const wrong = { ...services, services: [{ name: 'io.example.app.other' }] };
    expect(checkServiceIds('io.example.app', wrong, pkg).join('\n')).toContain('service names');
  });

  it('rejects a missing service entry', () => {
    const none = { ...services, services: [] };
    expect(checkServiceIds('io.example.app', none, pkg).join('\n')).toContain('service names');
  });

  it('rejects a package.json name that differs', () => {
    const wrong = { name: 'io.example.app' };
    expect(checkServiceIds('io.example.app', services, wrong).join('\n')).toContain(
      'package.json name',
    );
  });
});

describe('serviceSourceFiles', () => {
  it('keeps service js files and drops tests and non-js files', () => {
    expect(
      serviceSourceFiles([
        'index.js',
        'proxy.js',
        'proxy.test.js',
        'proxy.test.ts',
        'services.json',
      ]),
    ).toEqual(['index.js', 'proxy.js']);
  });
});

describe('checkNoServiceTests', () => {
  it('accepts a service folder without tests', () => {
    expect(checkNoServiceTests(['index.js', 'proxy.js', 'services.json'])).toEqual([]);
  });

  it.each(['proxy.test.ts', 'proxy.test.js', 'proxy.spec.js', 'lib/a.spec.ts'])(
    'rejects %s',
    (name) => {
      expect(checkNoServiceTests(['index.js', name]).join('\n')).toContain(name);
    },
  );
});
