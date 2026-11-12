import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from './index';
import { setLanguageSetting } from './languageSetting';
import de from './de.json';
import en from './en.json';
import { sectionTitle, useSectionTitle } from './sectionTitle';
import { translate, type Language, type MessageKey, type Params } from './translate';

const t = (language: Language) => (key: MessageKey, params?: Params) =>
  translate(language, key, params);

/** The `title_key` values of Silo's own catalogue (the web client's home.section.* messages). */
const SERVER_KEYS = [
  'home.section.becauseYouEnjoy',
  'home.section.becauseYouWatched',
  'home.section.becauseYouWatchedTitle',
  'home.section.continueListening',
  'home.section.continueReading',
  'home.section.continueWatching',
  'home.section.discoverGenres',
  'home.section.discoverNetworks',
  'home.section.discoverOnAirSeries',
  'home.section.discoverPopularMovies',
  'home.section.discoverPopularSeries',
  'home.section.discoverStudios',
  'home.section.discoverTrendingMovies',
  'home.section.discoverTrendingSeries',
  'home.section.discoverUpcomingMovies',
  'home.section.forYou',
  'home.section.hiddenGems',
  'home.section.highlyRatedInLibrary',
  'home.section.nextInYourSeries',
  'home.section.nextUp',
  'home.section.pickedFromYourHistory',
  'home.section.popularOnServer',
  'home.section.profilesLikeYouEnjoyed',
  'home.section.randomPicks',
  'home.section.recentlyAdded',
  'home.section.recentlyAddedAudiobooks',
  'home.section.recentlyAddedEbooks',
  'home.section.recentlyAddedIn',
  'home.section.recentlyAddedManga',
  'home.section.recentlyAddedMovies',
  'home.section.recentlyAddedTv',
  'home.section.recentlyReleased',
  'home.section.recentlyReleasedAudiobooks',
  'home.section.recentlyReleasedEbooks',
  'home.section.recentlyReleasedEpisodes',
  'home.section.recentlyReleasedEpisodesIn',
  'home.section.recentlyReleasedIn',
  'home.section.recentlyReleasedManga',
  'home.section.recentlyReleasedMovies',
  'home.section.recommendedForYou',
  'home.section.returningShows',
  'home.section.seasonal.christmas.classics',
  'home.section.seasonal.christmas.comedies',
  'home.section.seasonal.christmas.family',
  'home.section.seasonal.christmas.favorites',
  'home.section.seasonal.christmas.hallmark',
  'home.section.seasonal.christmas.romcoms',
  'home.section.seasonal.easter.faith',
  'home.section.seasonal.easter.family',
  'home.section.seasonal.familyMovieNight.favorites',
  'home.section.seasonal.familyMovieNight.liveAction',
  'home.section.seasonal.familyMovieNight.new',
  'home.section.seasonal.halloween.animated',
  'home.section.seasonal.halloween.family',
  'home.section.seasonal.halloween.favorites',
  'home.section.seasonal.halloween.horror',
  'home.section.seasonal.halloween.tv',
  'home.section.seasonal.newYear.favorites',
  'home.section.seasonal.saturdayMorning.cartoons',
  'home.section.seasonal.saturdayMorning.modern',
  'home.section.seasonal.saturdayMorning.nineties',
  'home.section.seasonal.stPatricks.irishFilm',
  'home.section.seasonal.stPatricks.irishTv',
  'home.section.seasonal.summer.blockbusters',
  'home.section.seasonal.summer.classicSummer',
  'home.section.seasonal.summer.nostalgia',
  'home.section.seasonal.summerBlockbuster.blockbusters',
  'home.section.seasonal.summerBlockbuster.classicSummer',
  'home.section.seasonal.summerBlockbuster.nostalgia',
  'home.section.seasonal.thanksgiving.favorites',
  'home.section.seasonal.thanksgiving.feelGood',
  'home.section.seasonal.valentines.favorites',
  'home.section.seasonal.valentines.loveStories',
  'home.section.seasonal.valentines.romanticDramas',
  'home.section.seasonal.valentines.romcoms',
  'home.section.seasonalPicks',
  'home.section.topGenre',
  'home.section.topPicksToday',
  'home.section.topRated',
  'home.section.topRatedMovies',
  'home.section.topRatedTv',
  'home.section.trendingOnServer',
  'home.section.trendingThisWeek',
];

/** The argument names the server sends for the keys whose message has placeholders. */
const ARGS: Record<string, Record<string, string>> = {
  'home.section.becauseYouEnjoy': { genres: 'Drama' },
  'home.section.becauseYouWatchedTitle': { title: 'Heat' },
  'home.section.recentlyAddedIn': { library: 'Filme' },
  'home.section.recentlyReleasedEpisodesIn': { library: 'Filme' },
  'home.section.recentlyReleasedIn': { library: 'Filme' },
  'home.section.topGenre': { genre: 'Drama' },
};

describe('sectionTitle', () => {
  it('shows the German text for a known key in a German interface', () => {
    expect(
      sectionTitle(
        { title: 'Continue Watching', title_key: 'home.section.continueWatching' },
        'de',
        t('de'),
      ),
    ).toBe('Weiterschauen');
  });

  it('fills the arguments of the key', () => {
    expect(
      sectionTitle(
        {
          title: 'Recently Added in Movies',
          title_key: 'home.section.recentlyAddedIn',
          title_args: { library: 'Filme' },
        },
        'de',
        t('de'),
      ),
    ).toBe('Kürzlich hinzugefügt in Filme');
    expect(
      sectionTitle(
        {
          title: 'Because you enjoy Drama, Crime',
          title_key: 'home.section.becauseYouEnjoy',
          title_args: { genres: 'Drama, Krimi' },
        },
        'de',
        t('de'),
      ),
    ).toBe('Weil du Drama, Krimi magst');
    expect(
      sectionTitle(
        {
          title: 'Because You Watched Heat',
          title_key: 'home.section.becauseYouWatchedTitle',
          title_args: { title: 'Heat' },
        },
        'de',
        t('de'),
      ),
    ).toBe('Weil du Heat geschaut hast');
  });

  it('shows the server title for a key the catalogue does not know', () => {
    expect(
      sectionTitle({ title: 'Made Up', title_key: 'home.section.madeUp' }, 'de', t('de')),
    ).toBe('Made Up');
    expect(sectionTitle({ title: 'Other', title_key: 'web.admin.title' }, 'de', t('de'))).toBe(
      'Other',
    );
  });

  it('shows the server title when an argument of the key is missing', () => {
    expect(
      sectionTitle(
        { title: 'Recently Added in', title_key: 'home.section.recentlyAddedIn', title_args: {} },
        'de',
        t('de'),
      ),
    ).toBe('Recently Added in');
    expect(
      sectionTitle(
        { title: 'Recently Added in', title_key: 'home.section.recentlyAddedIn' },
        'de',
        t('de'),
      ),
    ).toBe('Recently Added in');
  });

  it.each([
    'x'.repeat(13) + 'forYou',
    'other.forYou',
    'section.' + 'x'.repeat(5) + 'forYou',
    'section.title.forYou',
  ])('shows the server title for the key %s outside home.section.', (titleKey) => {
    expect(sectionTitle({ title: 'Server', title_key: titleKey }, 'de', t('de'))).toBe('Server');
  });

  it('shows the server title for a row without a key (typed by an administrator)', () => {
    expect(sectionTitle({ title: 'My Picks' }, 'de', t('de'))).toBe('My Picks');
  });

  it('shows the title as sent in an English interface, even with a key', () => {
    expect(
      sectionTitle(
        { title: 'Server Wording', title_key: 'home.section.continueWatching' },
        'en',
        t('en'),
      ),
    ).toBe('Server Wording');
  });
});

describe('the section title catalogue', () => {
  it.each(SERVER_KEYS)('has %s in German and English', (serverKey) => {
    const key = 'section.title.' + serverKey.slice('home.section.'.length);
    expect(Object.keys(de)).toContain(key);
    expect(Object.keys(en)).toContain(key);
    // Filled with the arguments the server sends for this key, the German text is complete and
    // is not the fallback title: a placeholder the server does not fill would fall back.
    const text = sectionTitle(
      { title: 'FALLBACK', title_key: serverKey, title_args: ARGS[serverKey] ?? {} },
      'de',
      t('de'),
    );
    expect(text).not.toBe('FALLBACK');
    expect(text).not.toContain('{');
  });

  it('holds only the messages of the server keys', () => {
    const own = Object.keys(de).filter((key) => key.startsWith('section.title.'));
    expect(own.sort()).toEqual(
      SERVER_KEYS.map((key) => 'section.title.' + key.slice('home.section.'.length)).sort(),
    );
  });
});

describe('useSectionTitle', () => {
  const section = { title: 'Continue Watching', title_key: 'home.section.continueWatching' };
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(I18nProvider, null, children);
  afterEach(() => act(() => setLanguageSetting('auto')));

  it('keeps its function while the language stays', () => {
    act(() => setLanguageSetting('de'));
    const { result, rerender } = renderHook(() => useSectionTitle(), { wrapper });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('gives the title of the new language when the language switches', () => {
    act(() => setLanguageSetting('en'));
    const { result } = renderHook(() => useSectionTitle(), { wrapper });
    expect(result.current(section)).toBe('Continue Watching');
    act(() => setLanguageSetting('de'));
    expect(result.current(section)).toBe('Weiterschauen');
  });
});
