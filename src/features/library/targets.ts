import type { LibraryKind } from './queries';

/** A row of a library's Recommended view whose full list a screen of its own shows. */
export interface ExploreTarget {
  id: string;
  title: string;
  /** Set for a row of a library; Home's rows have none. */
  library?: {
    id: string;
    /** The kind to cut out of a mixed library; absent when the library holds only one kind. */
    type?: LibraryKind;
  };
}

/** A collection of a library whose page a screen of its own shows. */
export interface CollectionTarget {
  libraryId: string;
  collectionId: string;
  title: string;
  /** The kind to cut out of a mixed library's collection; absent for other libraries. */
  type?: LibraryKind;
}
