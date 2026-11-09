// A stand-in for an HTMLAudioElement: records what the theme music controller does to it.
import type { ThemeAudio } from '../features/detail/themeMusic';

export class FakeAudio implements ThemeAudio {
  src = '';
  volume = 1;
  loop = false;
  played = 0;
  paused = false;
  loads = 0;
  playResult: Promise<void> = Promise.resolve();
  listeners: Record<string, (() => void)[]> = {};
  play() {
    this.played += 1;
    return this.playResult;
  }
  pause() {
    this.paused = true;
  }
  load() {
    this.loads += 1;
  }
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
  addEventListener(type: string, listener: () => void) {
    (this.listeners[type] ??= []).push(listener);
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((entry) => entry !== listener);
  }
  fire(type: 'ended' | 'error') {
    for (const listener of [...(this.listeners[type] ?? [])]) listener();
  }
}
