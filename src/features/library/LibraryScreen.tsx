import { useState } from 'react';
import { Button, ErrorState, ListSkeleton, Screen } from '../../app/ui';
import { useT } from '../../i18n';
import { useFirstLibrary, useSignOut, type CatalogItem } from './queries';

export function LibraryScreen({ onBack }: { onBack: () => void }) {
  const t = useT();
  const { library, items, isLoading, isError, noLibrary, retry } = useFirstLibrary();
  const signOut = useSignOut();
  const [selected, setSelected] = useState<CatalogItem | null>(null);

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
              data-autofocus={index === 0 ? true : undefined}
              onClick={() => setSelected(item)}
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
      {selected ? (
        <p role="status" className="note toast" data-testid="playback-note">
          {t('library.playbackNext', { title: selected.title })}
        </p>
      ) : null}
      {body}
    </Screen>
  );
}
