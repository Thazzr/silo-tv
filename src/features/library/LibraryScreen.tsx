import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../app/ui';
import { FocusTrackerContext, getCurrentFocusKey, setFocus } from '../../app/nav';
import { useContentBack } from '../../app/shell/ShellBack';
import { AVATAR_KEY, TAB_SWITCH_DELAY_MS, tabOfKey } from '../../app/shell/tabs';
import { useT, type MessageKey } from '../../i18n';
import { RowSkeleton, type CatalogItem } from '../../ui/media';
import type { DetailTarget } from '../detail/detailMemory';
import { BrowseView, type BrowseOverlay } from './BrowseView';
import { CollectionsView } from './CollectionsView';
import { LIBRARY_VIEWS, type LibraryMemory, type LibraryView } from './libraryMemory';
import { OverlayBackContext, type OverlayBack } from './OverlayBack';
import { PillRow } from './PillRow';
import { DIALOG_KEY_PREFIX } from './SortList';
import { librariesOfKind, useLibraries, type LibraryKind } from './queries';
import { RecommendedView } from './RecommendedView';
import type { CollectionTarget, ExploreTarget } from './targets';

const LIBRARY_KEY_PREFIX = 'lib-pill:';
const VIEW_KEY_PREFIX = 'lib-view:';
const libraryPillKey = (id: string) => `${LIBRARY_KEY_PREFIX}${id}`;
const viewPillKey = (view: LibraryView) => `${VIEW_KEY_PREFIX}${view}`;

const VIEW_LABELS: Record<LibraryView, MessageKey> = {
  recommended: 'library.view.recommended',
  browse: 'library.view.browse',
  collections: 'library.view.collections',
};

const NO_LIBRARY_TEXT: Record<LibraryKind, MessageKey> = {
  movie: 'library.noMovies',
  series: 'library.noSeries',
};

export interface LibraryScreenProps {
  kind: LibraryKind;
  memory: LibraryMemory;
  onPlay: (item: CatalogItem) => void;
  onOpenDetail: (target: DetailTarget) => void;
  /** "Explore all" of a Recommended row: opens its full list. */
  onExploreSection: (section: ExploreTarget) => void;
  /** OK on a collection: opens its page. */
  onOpenCollection: (target: CollectionTarget) => void;
  /** How long a focused pill waits before its content replaces the old one; tests stretch it. */
  switchDelayMs?: number;
}

/**
 * The content of the Movies and Series tabs: the libraries of the kind as pills (when there are
 * several), the sub-views Recommended, Browse and Collections as pills below them, and the
 * selected view. A pill that keeps the focus shows its content after a short rest; OK shows it
 * at once; moving on before that leaves the content as it was. The library, the sub-view and the
 * Browse choices are kept in `memory`.
 *
 * Back leaves the content step by step: from a view to its pill, to the library pills, to the
 * tab bar (the shell's rule, answered through `useContentBack`).
 */
export function LibraryScreen({
  kind,
  memory,
  onPlay,
  onOpenDetail,
  onExploreSection,
  onOpenCollection,
  switchDelayMs = TAB_SWITCH_DELAY_MS,
}: LibraryScreenProps) {
  const t = useT();
  const libraries = useLibraries();
  const outerTracker = useContext(FocusTrackerContext);

  const candidates = useMemo(
    () => (libraries.data ? librariesOfKind(libraries.data, kind) : []),
    [libraries.data, kind],
  );
  const [libraryId, setLibraryId] = useState(() => memory.libraryOf(kind));
  const library = candidates.find((l) => l.id === libraryId) ?? candidates[0];
  const [view, setView] = useState<LibraryView>(() => memory.viewOf(kind));
  const [overlay, setOverlay] = useState<BrowseOverlay>(null);

  // --- A pill that keeps the focus shows its content after a short rest -------------------------
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPending = useCallback(() => {
    if (pending.current !== null) clearTimeout(pending.current);
    pending.current = null;
  }, []);
  useEffect(() => clearPending, [clearPending]);

  const selectLibrary = useCallback(
    (id: string) => {
      clearPending();
      memory.selectLibrary(kind, id);
      setLibraryId(id);
    },
    [clearPending, kind, memory],
  );
  const selectView = useCallback(
    (next: LibraryView) => {
      clearPending();
      memory.selectView(kind, next);
      setView(next);
    },
    [clearPending, kind, memory],
  );
  const rest = useCallback(
    (apply: () => void) => {
      clearPending();
      pending.current = setTimeout(() => {
        pending.current = null;
        apply();
      }, switchDelayMs);
    },
    [clearPending, switchDelayMs],
  );

  const libraryRef = useRef(library);
  const viewRef = useRef(view);
  useEffect(() => {
    libraryRef.current = library;
    viewRef.current = view;
  });

  // Every focusable below reports here. Anything but a pill ends a pending switch ("Down before
  // the delay ran out"); the keys of a list or panel are the screen's own and go no further.
  const track = useCallback(
    (focusKey: string) => {
      if (!focusKey.startsWith(LIBRARY_KEY_PREFIX) && !focusKey.startsWith(VIEW_KEY_PREFIX)) {
        clearPending();
      }
      if (!focusKey.startsWith(DIALOG_KEY_PREFIX)) outerTracker?.(focusKey);
    },
    [clearPending, outerTracker],
  );

  // --- Back --------------------------------------------------------------------------------------
  const overlayBack = useRef<OverlayBack | null>(null);
  const registerOverlayBack = useCallback((handler: OverlayBack | null) => {
    overlayBack.current = handler;
  }, []);
  const overlayRef = useRef(overlay);
  useEffect(() => {
    overlayRef.current = overlay;
  });
  const severalLibraries = candidates.length > 1;
  useContentBack(() => {
    if (overlayRef.current) {
      if (!overlayBack.current?.()) setOverlay(null);
      return true;
    }
    const focused = getCurrentFocusKey();
    // Nothing of ours has the focus (the tab bar, the avatar): the shell decides.
    if (!focused || tabOfKey(focused) !== null || focused === AVATAR_KEY) return false;
    if (focused.startsWith(LIBRARY_KEY_PREFIX)) return false;
    const current = libraryRef.current;
    if (focused.startsWith(VIEW_KEY_PREFIX)) {
      if (!severalLibraries || !current) return false;
      void setFocus(libraryPillKey(current.id));
      return true;
    }
    void setFocus(viewPillKey(viewRef.current));
    return true;
  });

  // --- Body --------------------------------------------------------------------------------------
  if (libraries.isPending) {
    return (
      <section className="library" data-testid="library-screen" data-kind={kind}>
        <div role="status" aria-label={t('library.loading')} data-testid="library-loading">
          <RowSkeleton shape="poster" />
          <RowSkeleton shape="poster" />
        </div>
      </section>
    );
  }
  if (libraries.isError) {
    return (
      <section className="library" data-testid="library-screen" data-kind={kind}>
        <div className="library-message" role="alert" data-testid="library-error">
          <p className="error">{t('library.error')}</p>
          <Button focusKey="library-retry" onClick={() => void libraries.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      </section>
    );
  }
  if (!library) {
    return (
      <section className="library" data-testid="library-screen" data-kind={kind}>
        <div className="library-message" data-testid="library-none">
          <p className="note">{t(NO_LIBRARY_TEXT[kind])}</p>
        </div>
      </section>
    );
  }

  let content;
  switch (view) {
    case 'recommended':
      content = (
        <RecommendedView
          key={library.id}
          library={library}
          kind={kind}
          memory={memory}
          onPlay={onPlay}
          onOpenDetail={onOpenDetail}
          onExploreSection={onExploreSection}
        />
      );
      break;
    case 'browse':
      content = (
        <BrowseView
          key={library.id}
          library={library}
          kind={kind}
          memory={memory}
          overlay={overlay}
          onOverlay={setOverlay}
          onPlay={onPlay}
          onOpenDetail={onOpenDetail}
        />
      );
      break;
    case 'collections':
      content = (
        <CollectionsView
          key={library.id}
          library={library}
          kind={kind}
          memory={memory}
          onOpenCollection={onOpenCollection}
        />
      );
      break;
  }

  return (
    <FocusTrackerContext.Provider value={track}>
      <OverlayBackContext.Provider value={registerOverlayBack}>
        <section className="library" data-testid="library-screen" data-kind={kind}>
          {severalLibraries ? (
            <PillRow
              focusKey="library-pills"
              keyPrefix={LIBRARY_KEY_PREFIX}
              label={t('library.pills')}
              items={candidates.map((l) => ({ id: l.id, label: l.name }))}
              selected={library.id}
              onFocusPill={(id) => {
                if (id === library.id) clearPending();
                else rest(() => selectLibrary(id));
              }}
              onPick={selectLibrary}
              testId="library-pills"
            />
          ) : null}
          <PillRow
            focusKey="library-views"
            keyPrefix={VIEW_KEY_PREFIX}
            label={t('library.views')}
            items={LIBRARY_VIEWS.map((id) => ({ id, label: t(VIEW_LABELS[id]) }))}
            selected={view}
            onFocusPill={(id) => {
              if (id === view) clearPending();
              else rest(() => selectView(id as LibraryView));
            }}
            onPick={(id) => selectView(id as LibraryView)}
            testId="view-pills"
          />
          <div className="library-body">{content}</div>
        </section>
      </OverlayBackContext.Provider>
    </FocusTrackerContext.Provider>
  );
}
