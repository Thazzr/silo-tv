import { useState } from 'react';
import { Button, ErrorState, ListSkeleton, Screen } from '../../app/ui';
import { useT } from '../../i18n';
import { useFirstLibrary, useSignOut, type CatalogItem } from './queries';

export function LibraryScreen({
  onBack,
  onPlay,
}: {
  onBack: () => void;
  /** Opens the player for a title; the screen stack keeps this list underneath. */
  onPlay: (item: CatalogItem) => void;
}) {
  const t = useT();
  const { library, items, isLoading, isError, noLibrary, retry } = useFirstLibrary();
  const signOut = useSignOut();
  const [seriesNote, setSeriesNote] = useState(false);

  const open = (item: CatalogItem) => {
    // Series are not directly playable; their episodes come with Phase 2.
    if (item.type.trim().toLowerCase() === 'series') {
      setSeriesNote(true);
      return;
    }
    setSeriesNote(false);
    onPlay(item);
  };

  let body;
  if (isLoading) {
    body = <ListSkeleton label={t('library.loading')} />;
  } else if (isError) {
    body = <ErrorState message={t('library.error')} onRetry={retry} />;
  } else if (noLibrary) {
    body = <p className="note">{t('library.noLibrary')}</p>;
  } else if (items?.length === 0) {
    body = <p className="note">{t('library.empty')}</p>;
  } else {
    body = (
      <ul className="list" data-testid="title-list">
        {items?.map((item, index) => (
          <li key={item.content_id}>
            <Button
              focusKey={`title-${item.content_id}`}
              className="row"
              autoFocus={index === 0}
              onClick={() => open(item)}
            >
              <span className="grow">{item.title}</span>
              {item.year ? <span className="year">{item.year}</span> : null}
            </Button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Screen title={library?.name ?? t('library.title')} onBack={onBack} testId="library-screen">
      <Button
        focusKey="signout"
        className="secondary"
        disabled={signOut.isPending}
        onClick={() => signOut.mutate()}
      >
        {t('library.signOut')}
      </Button>
      {seriesNote ? (
        <p role="status" className="note toast" data-testid="series-note">
          {t('library.seriesLater')}
        </p>
      ) : null}
      {body}
    </Screen>
  );
}
