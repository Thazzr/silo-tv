import { FocusIndexMemory } from '../../ui/media/scroll';
import { DEFAULT_BROWSE, type BrowseSelection } from './browse';

/** What a Movies or Series tab can show under its library. */
export const LIBRARY_VIEWS = ['recommended', 'browse', 'collections'] as const;
export type LibraryView = (typeof LIBRARY_VIEWS)[number];

/** The kinds of library tab. */
export type TabKind = 'movie' | 'series';

/**
 * What the library tabs remember for the session: the library and the sub-view each tab showed,
 * the sort, filters and letter of every library's Browse, and, through `indices`, the focused card of every row and grid.
 * It lives with the shell's memory, because leaving a tab or opening a title unmounts the tab.
 */
export class LibraryMemory {
  private readonly libraries: Partial<Record<TabKind, string>> = {};
  private readonly views: Partial<Record<TabKind, LibraryView>> = {};
  private readonly browse = new Map<string, BrowseSelection>();
  /** The focused card of every row and grid, and the focused row of each Recommended view. */
  readonly indices = new FocusIndexMemory();

  libraryOf(kind: TabKind): string | undefined {
    return this.libraries[kind];
  }

  selectLibrary(kind: TabKind, libraryId: string): void {
    this.libraries[kind] = libraryId;
  }

  viewOf(kind: TabKind): LibraryView {
    return this.views[kind] ?? 'recommended';
  }

  selectView(kind: TabKind, view: LibraryView): void {
    this.views[kind] = view;
  }

  /** A mixed library's Movies and Series tabs keep their own choices. */
  browseOf(kind: TabKind, libraryId: string): BrowseSelection {
    return this.browse.get(`${kind}:${libraryId}`) ?? DEFAULT_BROWSE;
  }

  setBrowse(kind: TabKind, libraryId: string, selection: BrowseSelection): void {
    this.browse.set(`${kind}:${libraryId}`, selection);
  }

  reset(): void {
    for (const key of Object.keys(this.libraries)) delete this.libraries[key as TabKind];
    for (const key of Object.keys(this.views)) delete this.views[key as TabKind];
    this.browse.clear();
    this.indices.clear();
  }
}
