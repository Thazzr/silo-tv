import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../app/ui';
import { useLanguage, useT } from '../../i18n';
import { Artwork, useMediaUrl } from '../../ui/media';
import { initials } from '../detail/info';
import { personFacts, type Person } from './info';

/**
 * A biography longer than this many characters is taken to be cut at seven lines when the layout
 * cannot say (it is measured wherever there is a layout): 24 px text in a 1000 px column.
 */
const SEVEN_LINES_CHARS = 600;

/** The biography, at most seven lines, with "More" under it when the text goes on. */
function Biography({ text, onMore }: { text: string; onMore: () => void }) {
  const t = useT();
  const ref = useRef<HTMLParagraphElement>(null);
  const [measured, setMeasured] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    // Without a layout (the unit tests) every box is 0 px high: the length estimate stands.
    if (el && el.clientHeight > 0) setMeasured(el.scrollHeight > el.clientHeight + 1);
    else setMeasured(null);
  }, [text]);
  const clamped = measured ?? text.length > SEVEN_LINES_CHARS;
  return (
    <>
      <p ref={ref} className="person-bio" data-testid="person-bio">
        {text}
      </p>
      {clamped ? (
        <Button focusKey="person-more" className="person-more" onClick={onMore}>
          {t('detail.more')}
        </Button>
      ) : null}
    </>
  );
}

/** The portrait on the surface colour; the name's initials stand in when there is no photo. */
function Portrait({
  name,
  photo,
  thumbhash,
}: {
  name: string;
  photo?: string;
  thumbhash?: string;
}) {
  const url = useMediaUrl();
  return (
    <div className="person-portrait" data-testid="person-portrait">
      <Artwork src={url(photo)} thumbhash={thumbhash} title={initials(name)} />
    </div>
  );
}

/**
 * The top of a person page: portrait, name, the badge line (birth, age or death, birthplace) and
 * the biography. `faded` hides it once the page has scrolled to the filmography.
 */
export function PersonHeader({
  person,
  onMore,
  faded,
}: {
  person: Person;
  onMore: () => void;
  faded: boolean;
}) {
  const t = useT();
  const lang = useLanguage();
  const facts = personFacts(person, lang, t);
  const bio = person.bio?.trim();
  return (
    <div className="person-header" data-testid="person-header" data-faded={faded}>
      <Portrait name={person.name} photo={person.photo_url} thumbhash={person.photo_thumbhash} />
      <div className="person-text">
        <h1 className="person-name" data-testid="person-name">
          {person.name}
        </h1>
        {facts.length > 0 ? (
          <ul className="person-facts" data-testid="person-facts">
            {facts.map((fact) => (
              <li key={fact} className="person-fact">
                {fact}
              </li>
            ))}
          </ul>
        ) : null}
        {bio ? <Biography text={bio} onMore={onMore} /> : null}
      </div>
    </div>
  );
}

/** The loading stand-in of the header: the portrait box, the name (when known) and bars. */
export function PersonHeaderSkeleton({ name }: { name?: string }) {
  return (
    <div className="person-header" aria-hidden="true">
      <div className="person-portrait skeleton-block" />
      <div className="person-text">
        {name ? (
          <h1 className="person-name" data-testid="person-name">
            {name}
          </h1>
        ) : (
          <div className="skeleton-bar person-skeleton-name" />
        )}
        <div className="skeleton-bar person-skeleton-facts" />
        <div className="skeleton-bar person-skeleton-bio" />
      </div>
    </div>
  );
}
