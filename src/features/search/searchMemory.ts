import { FocusIndexMemory } from '../../ui/media/scroll';
import { MAX_QUERY_LENGTH, type Segment } from './info';

/**
 * What the Search tab remembers while a title, person or box set page covers it: the typed text,
 * the segment, the last key of the keyboard and, through `indices`, the focused card of each
 * results block. It lives with the shell's memory, because the screen stack unmounts the shell
 * while another page is open. The results themselves come back from the query cache.
 */
export class SearchMemory {
  private text = '';
  private current: Segment = 'all';
  private key: string | undefined;
  readonly indices = new FocusIndexMemory();

  get query(): string {
    return this.text;
  }

  /** The last key of the keyboard that had the focus. */
  get lastKey(): string | undefined {
    return this.key;
  }

  rememberKey(id: string): void {
    this.key = id;
  }

  get segment(): Segment {
    return this.current;
  }

  /** New text starts new results: their cards are all different, so the old focus positions go. */
  setQuery(text: string): void {
    this.text = text.slice(0, MAX_QUERY_LENGTH);
    this.indices.clear();
  }

  setSegment(segment: Segment): void {
    this.current = segment;
    this.indices.clear();
  }

  reset(): void {
    this.text = '';
    this.current = 'all';
    this.key = undefined;
    this.indices.clear();
  }
}
