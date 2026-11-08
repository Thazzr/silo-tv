import { useState } from 'react';
import { Button, ErrorState, ListSkeleton, Screen } from '../../app/ui';
import { useT } from '../../i18n';
import { PlayerScreen } from '../../playback/PlayerScreen';
import { useFirstLibrary, useSignOut, type CatalogItem } from './queries';

export function LibraryScreen({ onBack }: { onBack: () => void }) {
  const t = useT();
  const { library, items, isLoading, isError, noLibrary, retry } = useFirstLibrary();
  const signOut = useSignOut();
  const [playing, setPlaying] = useState<CatalogItem | null>(null);
  // The title that was opened last: focus returns to it when the player closes.
  const [lastOpened, setLastOpened] = useState<string | null>(null);
  const [seriesNote, setSeriesNote] = useState(false);

  const open = (item: CatalogItem) => {
    setLastOpened(item.content_id);
    // Series are not directly playable; their episodes come with Phase 2.
    if (item.type.trim().toLowerCase() === 'series') {
      setSeriesNote(true);
      return;
    }
    setSeriesNote(false);
    setPlaying(item);
  };

  if (playing) {
    return (
      <PlayerScreen
        contentId={playing.content_id}
        title={playing.title}
        onExit={() => setPlaying(null)}
      />
    );
  }

  const focusIndex = Math.max(0, items?.findIndex((item) => item.content_id === lastOpened) ?? 0);

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
              className="row"
              data-autofocus={index === focusIndex ? true : undefined}
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
      <Button className="secondary" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
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
