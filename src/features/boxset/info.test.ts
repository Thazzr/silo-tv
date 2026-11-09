import { describe, expect, it } from 'vitest';
import { translate } from '../../i18n';
import { boxSetDetail, boxSetFilms } from '../../test/boxSetFixtures';
import { chipLine, playLabel, playTarget } from './info';

const en = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
  translate('en', key, params);
const de = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
  translate('de', key, params);

describe('playTarget', () => {
  it('is the first film when nothing is played, and does not continue', () => {
    const target = playTarget(boxSetDetail({}, 3, 0));
    expect(target?.item.content_id).toBe('film-1');
    expect(target?.continuing).toBe(false);
  });

  it('is the first unplayed film in collection order when some are played, and continues', () => {
    const target = playTarget(boxSetDetail({}, 4, 2));
    expect(target?.item.content_id).toBe('film-3');
    expect(target?.continuing).toBe(true);
  });

  it('skips a played film that stands after an unplayed one only when it is not the first unplayed', () => {
    // Film 1 is unplayed, film 2 played: the first unplayed film in order wins.
    const items = boxSetFilms(3, 0);
    items[1] = { ...items[1]!, user_state: { ...items[1]!.user_state!, played: true } };
    const target = playTarget(boxSetDetail({ items, played_count: 1 }));
    expect(target?.item.content_id).toBe('film-1');
  });

  it('is the first film once all are played, and does not continue', () => {
    const target = playTarget(boxSetDetail({}, 3, 3));
    expect(target?.item.content_id).toBe('film-1');
    expect(target?.continuing).toBe(false);
  });

  it('takes the film from the watch states and the wording from the count when they disagree', () => {
    // The count says nothing is played, but film 1 is: the target moves on, the label stays "Play".
    const items = boxSetFilms(3, 1);
    const none = playTarget(boxSetDetail({ items, played_count: 0 }));
    expect(none?.item.content_id).toBe('film-2');
    expect(none?.continuing).toBe(false);
    // The count says some are played, but no film is: the target is the first, the label continues.
    const some = playTarget(boxSetDetail({ items: boxSetFilms(3, 0), played_count: 1 }));
    expect(some?.item.content_id).toBe('film-1');
    expect(some?.continuing).toBe(true);
  });

  it('treats a film without a watch state as unplayed, and has no target without films', () => {
    const items = boxSetFilms(2, 0).map((film) => ({ ...film, user_state: undefined }));
    expect(playTarget(boxSetDetail({ items }))?.item.content_id).toBe('film-1');
    expect(playTarget(boxSetDetail({ items: [] }))).toBeNull();
  });
});

describe('playLabel', () => {
  it('names the film: "Play" for a box set not begun or finished, "Continue" in between', () => {
    const fresh = playTarget(boxSetDetail({}, 3, 0))!;
    expect(playLabel(fresh, en)).toBe('Play Film 1');
    expect(playLabel(fresh, de)).toBe('Film 1 abspielen');
    const begun = playTarget(boxSetDetail({}, 3, 1))!;
    expect(playLabel(begun, en)).toBe('Continue · Film 2');
    expect(playLabel(begun, de)).toBe('Weiter · Film 2');
    const done = playTarget(boxSetDetail({}, 3, 3))!;
    expect(playLabel(done, en)).toBe('Play Film 1');
  });
});

describe('chipLine', () => {
  it('lists the badge, the count, the years and the progress', () => {
    expect(chipLine(boxSetDetail({}, 8, 5), en)).toBe(
      'BOX SET · 8 films · 2001–2003 · 5 of 8 watched',
    );
    expect(chipLine(boxSetDetail({}, 8, 5), de)).toBe(
      'BOX-SET · 8 Filme · 2001–2003 · 5 von 8 gesehen',
    );
  });

  it('leaves out the progress while nothing is played', () => {
    expect(chipLine(boxSetDetail({}, 3, 0), de)).toBe('BOX-SET · 3 Filme · 2001–2003');
  });

  it('leaves out the years when the server gave none, and shows one year when both are equal', () => {
    expect(chipLine(boxSetDetail({ first_year: undefined, last_year: undefined }, 3, 0), de)).toBe(
      'BOX-SET · 3 Filme',
    );
    expect(chipLine(boxSetDetail({ first_year: 1999, last_year: 1999 }, 2, 0), de)).toBe(
      'BOX-SET · 2 Filme · 1999',
    );
  });

  it('says "1 Film" for one film, and leaves the count out when it is zero', () => {
    expect(chipLine(boxSetDetail({}, 1, 0), de)).toContain('1 Film ·');
    expect(chipLine(boxSetDetail({ movie_count: 0, items: [] }), de)).toBe('BOX-SET · 2001–2003');
  });
});
