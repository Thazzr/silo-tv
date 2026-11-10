import { describe, expect, it } from 'vitest';
import { account } from '../../test/apiFixtures';
import { memoryStorage } from '../../test/renderFlow';
import { ServerRegistry } from './registry';

const A = 'https://a.example.test';
const B = 'https://b.example.test';
const C = 'http://192.0.2.10:8096';

const tokens = (access: string) => ({
  accessToken: access,
  refreshToken: `${access}-refresh`,
  expiresAt: Date.now() + 3600_000,
  user: account,
});

/** A registry on a manual clock, so "used later" does not depend on the real time. */
function setup(storage = memoryStorage()) {
  let time = 1000;
  const registry = new ServerRegistry(storage, () => time);
  return {
    registry,
    storage,
    tick: (ms = 1000) => {
      time += ms;
    },
    reopen: () => new ServerRegistry(storage, () => time),
  };
}

describe('ServerRegistry', () => {
  it('adds a server with the host as its name and keeps it across a restart', () => {
    const { registry, reopen } = setup();
    registry.add(A);
    expect(registry.list()).toEqual([{ origin: A, name: 'a.example.test', lastUsedAt: 1000 }]);
    expect(reopen().list()).toEqual(registry.list());
  });

  it('adding a known server again does not duplicate it and marks it as used', () => {
    const { registry, tick } = setup();
    registry.add(A);
    tick();
    registry.add(B);
    tick();
    registry.add(A);
    expect(registry.list().map((s) => s.origin)).toEqual([A, B]);
    expect(registry.current()?.origin).toBe(A);
  });

  it('lists the current (last used) server first, then the others by last use', () => {
    const { registry, tick } = setup();
    registry.add(A);
    tick();
    registry.add(B);
    tick();
    registry.add(C);
    expect(registry.list().map((s) => s.origin)).toEqual([C, B, A]);
    tick();
    registry.touch(A);
    expect(registry.list().map((s) => s.origin)).toEqual([A, C, B]);
    expect(registry.current()?.origin).toBe(A);
  });

  it('touch updates lastUsedAt, and two uses in one millisecond keep their order', () => {
    const { registry, tick } = setup();
    registry.add(A);
    tick(10);
    registry.touch(A);
    expect(registry.get(A)?.lastUsedAt).toBe(1010);
    // The clock stands still: the later use still counts as later.
    registry.add(B);
    registry.touch(A);
    expect(registry.list().map((s) => s.origin)).toEqual([A, B]);
    expect(registry.get(A)!.lastUsedAt).toBeGreaterThan(registry.get(B)!.lastUsedAt);
  });

  it('renaming changes the name but not the order or the last use', () => {
    const { registry, tick } = setup();
    registry.add(A);
    tick();
    registry.add(B);
    const before = registry.get(A)!.lastUsedAt;
    registry.rename(A, 'Movie Barn');
    expect(registry.get(A)).toMatchObject({ name: 'Movie Barn', lastUsedAt: before });
    expect(registry.list().map((s) => s.origin)).toEqual([B, A]);
    registry.rename(A, '   ');
    expect(registry.get(A)?.name).toBe('Movie Barn');
  });

  it('keeps one session per origin under its own storage key', () => {
    const { registry, storage, reopen } = setup();
    registry.add(A);
    registry.add(B);
    registry.session(A).set(tokens('token-a'));
    registry.session(B).set(tokens('token-b'));
    expect(registry.session(A)).toBe(registry.session(A));
    expect(registry.session(A).get()?.accessToken).toBe('token-a');
    expect(registry.session(B).get()?.accessToken).toBe('token-b');
    expect(storage.get(`silo-tv.session.v1.${A}`)).toContain('token-a-refresh');
    expect(storage.get(`silo-tv.session.v1.${B}`)).toContain('token-b-refresh');
    // They survive a restart, still separated.
    const again = reopen();
    expect(again.session(A).get()?.refreshToken).toBe('token-a-refresh');
    expect(again.session(B).get()?.refreshToken).toBe('token-b-refresh');
  });

  it('signing out of one server keeps the session of the other', () => {
    const { registry, reopen } = setup();
    registry.add(A);
    registry.add(B);
    registry.session(A).set(tokens('token-a'));
    registry.session(B).set(tokens('token-b'));
    registry.session(A).signOut();
    expect(registry.hasSession(A)).toBe(false);
    expect(registry.hasSession(B)).toBe(true);
    expect(reopen().hasSession(B)).toBe(true);
    expect(reopen().hasSession(A)).toBe(false);
  });

  it('removing a server deletes its entry and its session but not the other servers', () => {
    const { registry, storage, reopen } = setup();
    registry.add(A);
    registry.add(B);
    registry.session(A).set(tokens('token-a'));
    registry.session(B).set(tokens('token-b'));
    registry.remove(A);
    expect(registry.list().map((s) => s.origin)).toEqual([B]);
    expect(storage.get(`silo-tv.session.v1.${A}`)).toBeNull();
    expect(storage.get(`silo-tv.session.v1.${B}`)).not.toBeNull();
    // A server added again under the same address starts signed out.
    registry.add(A);
    expect(registry.hasSession(A)).toBe(false);
    expect(
      reopen()
        .list()
        .map((s) => s.origin),
    ).toEqual([A, B]);
    expect(reopen().hasSession(A)).toBe(false);
  });

  it('tells subscribers about every change of the list', () => {
    const { registry } = setup();
    let calls = 0;
    const off = registry.subscribe(() => {
      calls += 1;
    });
    registry.add(A);
    registry.rename(A, 'Movie Barn');
    registry.touch(A);
    registry.remove(A);
    expect(calls).toBe(4);
    off();
    registry.add(B);
    expect(calls).toBe(4);
  });

  it('drops the keys of the single-server app and ignores an unknown stored shape', () => {
    const storage = memoryStorage();
    storage.set('silo-tv.server.v1', A);
    storage.set('silo-tv.session.v1', '{"v":1}');
    storage.set('silo-tv.servers.v1', JSON.stringify({ v: 2, servers: [] }));
    const { registry } = setup(storage);
    expect(storage.get('silo-tv.server.v1')).toBeNull();
    expect(storage.get('silo-tv.session.v1')).toBeNull();
    expect(registry.list()).toEqual([]);
    storage.set('silo-tv.servers.v1', 'not json');
    expect(setup(storage).registry.list()).toEqual([]);
  });

  it('skips stored entries that are malformed', () => {
    const storage = memoryStorage();
    storage.set(
      'silo-tv.servers.v1',
      JSON.stringify({
        v: 1,
        servers: [{ origin: A, name: 'A', lastUsedAt: 5 }, { origin: B }, 7],
      }),
    );
    expect(
      setup(storage)
        .registry.list()
        .map((s) => s.origin),
    ).toEqual([A]);
  });
});
