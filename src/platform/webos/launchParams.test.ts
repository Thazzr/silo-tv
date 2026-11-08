import { afterEach, describe, expect, it } from 'vitest';
import { readLaunchParams } from './launchParams';

afterEach(() => {
  delete window.webOSSystem;
  delete window.PalmSystem;
  window.history.replaceState(null, '', '/');
});

describe('readLaunchParams', () => {
  it('is empty without launch params and query', () => {
    expect(readLaunchParams()).toEqual({});
  });

  it('reads the JSON launch params', () => {
    window.webOSSystem = { launchParams: '{"server":"https://silo.example.test"}' };
    expect(readLaunchParams()).toEqual({ server: 'https://silo.example.test' });
  });

  it('falls back to PalmSystem', () => {
    window.PalmSystem = { launchParams: '{"a":1}' };
    expect(readLaunchParams()).toEqual({ a: 1 });
  });

  it.each(['', 'garbage{', '[1,2]', 'null', '"text"'])('tolerates launch params %j', (raw) => {
    window.webOSSystem = { launchParams: raw };
    expect(readLaunchParams()).toEqual({});
  });

  it('reads URL query parameters', () => {
    window.history.replaceState(null, '', '/?server=https%3A%2F%2Fsilo.example.test');
    expect(readLaunchParams()).toEqual({ server: 'https://silo.example.test' });
  });

  it('lets the query override launch params', () => {
    window.webOSSystem = { launchParams: '{"server":"https://one.example.test","keep":true}' };
    window.history.replaceState(null, '', '/?server=https://two.example.test');
    expect(readLaunchParams()).toEqual({ server: 'https://two.example.test', keep: true });
  });
});
