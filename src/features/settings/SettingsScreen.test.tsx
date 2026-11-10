import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLanguageSetting, setLanguageSetting } from '../../i18n/languageSetting';
import { getResumeRewind, setResumeRewind } from '../../playback/resumeRewind';
import { getTimeMode, setTimeMode } from '../../playback/timeDisplay';
import { KEY, pressKey } from '../../test/keys';
import { renderWithSilo } from '../../test/renderFlow';
import { SettingsScreen } from './SettingsScreen';

beforeEach(() => {
  window.localStorage.clear();
  act(() => setLanguageSetting('auto'));
});

function setup() {
  const onBack = vi.fn();
  const view = renderWithSilo(<SettingsScreen onBack={onBack} />, { lang: undefined });
  return { onBack, ...view };
}

const pill = (name: string) => screen.getByRole('radio', { name });
const group = (id: string) => within(screen.getByTestId(id));

/** Walks from the first row (language) down to the rewind row; its selected pill takes the focus. */
async function toRewind() {
  await waitFor(() => expect(pill('Automatic (like the TV)')).toHaveFocus());
  await pressKey(KEY.down);
  await pressKey(KEY.down);
  await waitFor(() => expect(pill('7 s')).toHaveFocus());
}

describe('SettingsScreen sections', () => {
  it('shows the title, the device heading and its note', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'This TV' })).toBeInTheDocument();
    expect(screen.getByText('Applies to this TV only')).toBeInTheDocument();
  });

  it('puts the three rows in the device section: language, time display, rewind', () => {
    setup();
    const section = within(screen.getByTestId('settings-device'));
    const groups = section.getAllByRole('radiogroup');
    expect(groups.map((g) => g.getAttribute('data-testid'))).toEqual([
      'settings-language',
      'settings-time',
      'settings-rewind',
    ]);
    expect(groups.map((g) => g.getAttribute('aria-labelledby'))).toEqual([
      'settings-language-label',
      'settings-time-label',
      'settings-rewind-label',
    ]);
    expect(section.getByText('Language')).toBeInTheDocument();
    expect(section.getByText('Time display in the player')).toBeInTheDocument();
    expect(section.getByText('Rewind on resume')).toBeInTheDocument();
    // Everything on the screen is in that one section for now.
    expect(screen.getAllByRole('radiogroup')).toHaveLength(3);
  });

  it('keeps the section heading and note out of the focus order', () => {
    setup();
    const heading = screen.getByRole('heading', { level: 2, name: 'This TV' });
    expect(heading).not.toHaveAttribute('tabindex');
    expect(heading).not.toHaveAttribute('data-focus-key');
    const note = screen.getByText('Applies to this TV only');
    expect(note).not.toHaveAttribute('data-focus-key');
    // Every focusable on the screen is a pill.
    for (const el of document.querySelectorAll('[data-focus-key]')) {
      expect(el.getAttribute('role') ?? el.tagName).toMatch(/radio|BUTTON/);
    }
  });

  it('Down and Up walk the rows across the section in order, onto the selected pill of each', async () => {
    setup();
    await waitFor(() => expect(pill('Automatic (like the TV)')).toHaveFocus());
    await pressKey(KEY.down);
    await waitFor(() => expect(pill('Combined')).toHaveFocus());
    await pressKey(KEY.down);
    await waitFor(() => expect(pill('7 s')).toHaveFocus());
    await pressKey(KEY.up);
    await waitFor(() => expect(pill('Combined')).toHaveFocus());
    await pressKey(KEY.up);
    await waitFor(() => expect(pill('Automatic (like the TV)')).toHaveFocus());
  });

  it('Back leaves the screen', async () => {
    const { onBack } = setup();
    await waitFor(() => expect(pill('Automatic (like the TV)')).toHaveFocus());
    await pressKey(KEY.back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsScreen focus', () => {
  it('opens with the focus on the selected language pill, without a key press', async () => {
    setLanguageSetting('de');
    setup();
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Deutsch' })).toHaveFocus());
  });

  it('enters a row on its selected pill, not on the one highlighted last', async () => {
    setup();
    await waitFor(() => expect(pill('Automatic (like the TV)')).toHaveFocus());
    await pressKey(KEY.down);
    await waitFor(() => expect(pill('Combined')).toHaveFocus());
    // The highlight moves off the selected pill; nothing is selected.
    await pressKey(KEY.right);
    expect(pill('Position / length')).toHaveFocus();
    expect(pill('Combined')).toHaveClass('selected');
    await pressKey(KEY.down);
    await waitFor(() => expect(pill('7 s')).toHaveFocus());
    await pressKey(KEY.up);
    await waitFor(() => expect(pill('Combined')).toHaveFocus());
  });
});

describe('SettingsScreen in German', () => {
  it('labels the four time modes with four different texts', () => {
    setLanguageSetting('de');
    setup();
    expect(
      group('settings-time')
        .getAllByRole('radio')
        .map((p) => p.textContent),
    ).toEqual(['Kombiniert', 'Position/Länge', 'Restzeit', 'Endet um']);
  });
});

describe('SettingsScreen rewind row', () => {
  it('lists its pills', () => {
    setup();
    expect(
      group('settings-rewind')
        .getAllByRole('radio')
        .map((p) => p.textContent),
    ).toEqual(['Off', '5 s', '7 s', '10 s', '15 s', '20 s', '30 s']);
  });

  it('marks the selected pill (7 s by default) and focuses it when the row is entered', async () => {
    setup();
    await toRewind();
    expect(pill('7 s')).toHaveAttribute('aria-checked', 'true');
    expect(pill('7 s')).toHaveClass('selected');
    expect(pill('10 s')).toHaveAttribute('aria-checked', 'false');
  });

  it('enters on the stored value when it is a choice', async () => {
    setResumeRewind(20);
    setup();
    await waitFor(() => expect(pill('Automatic (like the TV)')).toHaveFocus());
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await waitFor(() => expect(pill('20 s')).toHaveFocus());
    expect(pill('20 s')).toHaveClass('selected');
  });

  it('marks no pill for a stored value that is not a choice, and still applies it', () => {
    setResumeRewind(12);
    setup();
    expect(group('settings-rewind').queryAllByRole('radio', { checked: true })).toHaveLength(0);
    expect(getResumeRewind()).toBe(12);
  });

  it('arrow keys alone move the highlight and never change the value', async () => {
    setup();
    await toRewind();
    await pressKey(KEY.right);
    expect(pill('10 s')).toHaveFocus();
    await pressKey(KEY.left);
    await pressKey(KEY.left);
    expect(pill('5 s')).toHaveFocus();
    expect(getResumeRewind()).toBe(7);
    expect(pill('7 s')).toHaveClass('selected');
    expect(pill('5 s')).not.toHaveClass('selected');
  });

  it('Right twice and OK from 7 s selects 15 s and stores it', async () => {
    setup();
    await toRewind();
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    expect(pill('15 s')).toHaveFocus();
    await pressKey(KEY.enter);
    expect(pill('15 s')).toHaveClass('selected');
    expect(pill('7 s')).not.toHaveClass('selected');
    expect(window.localStorage.getItem('silo-tv.settings.resumeRewindSeconds')).toBe('15');
    expect(getResumeRewind()).toBe(15);
  });

  it('Off stores 0', () => {
    setup();
    fireEvent.click(pill('Off'));
    expect(getResumeRewind()).toBe(0);
    expect(pill('Off')).toHaveClass('selected');
  });

  it('hover only moves the highlight; a click selects', async () => {
    setup();
    fireEvent.mouseEnter(pill('30 s'));
    await waitFor(() => expect(pill('30 s')).toHaveFocus());
    expect(getResumeRewind()).toBe(7);
    expect(pill('30 s')).not.toHaveClass('selected');
    fireEvent.click(pill('30 s'));
    expect(getResumeRewind()).toBe(30);
    expect(pill('30 s')).toHaveClass('selected');
  });
});

describe('SettingsScreen time display row', () => {
  it('offers the four modes, with Combined selected by default', () => {
    setup();
    expect(
      group('settings-time')
        .getAllByRole('radio')
        .map((p) => p.textContent),
    ).toEqual(['Combined', 'Position / length', 'Time left', 'End time']);
    expect(pill('Combined')).toHaveAttribute('aria-checked', 'true');
  });

  it('is operated by keyboard: Down to the row, Right to a mode, OK stores it', async () => {
    setup();
    await waitFor(() => expect(pill('Automatic (like the TV)')).toHaveFocus());
    await pressKey(KEY.down);
    await waitFor(() => expect(pill('Combined')).toHaveFocus());
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    expect(pill('Time left')).toHaveFocus();
    // Moving the highlight changes nothing.
    expect(getTimeMode()).toBe('combined');
    await pressKey(KEY.enter);
    expect(getTimeMode()).toBe('remaining');
    expect(pill('Time left')).toHaveClass('selected');
    expect(pill('Combined')).not.toHaveClass('selected');
    // The focus stays on the pill that was pressed.
    expect(pill('Time left')).toHaveFocus();
  });

  it('shows the stored mode as selected', () => {
    setTimeMode('endsAt');
    setup();
    expect(pill('End time')).toHaveAttribute('aria-checked', 'true');
  });
});

describe('SettingsScreen language row', () => {
  it('offers Automatic, Deutsch and English, each language in its own words', () => {
    setup();
    expect(
      group('settings-language')
        .getAllByRole('radio')
        .map((p) => p.textContent),
    ).toEqual(['Automatic (like the TV)', 'Deutsch', 'English']);
    expect(pill('Automatic (like the TV)')).toHaveAttribute('aria-checked', 'true');
  });

  it('is operated by keyboard: OK on Deutsch switches the whole screen at once, focus stays', async () => {
    setup();
    await waitFor(() => expect(pill('Automatic (like the TV)')).toHaveFocus());
    await pressKey(KEY.right);
    await waitFor(() => expect(pill('Deutsch')).toHaveFocus());
    await pressKey(KEY.enter);
    expect(getLanguageSetting()).toBe('de');
    expect(window.localStorage.getItem('silo-tv.settings.language')).toBe('de');
    // Visible texts are German now, and the option labels keep their own language.
    expect(screen.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Dieser Fernseher' })).toBeInTheDocument();
    expect(screen.getByText('Gilt nur für diesen TV')).toBeInTheDocument();
    expect(screen.getByText('Sprache')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Automatisch (wie Fernseher)' })).toBeInTheDocument();
    expect(pill('Deutsch')).toHaveClass('selected');
    expect(pill('English')).toBeInTheDocument();
    expect(pill('Deutsch')).toHaveFocus();
    // And back.
    await pressKey(KEY.right);
    await pressKey(KEY.enter);
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(pill('English')).toHaveFocus();
  });

  it('shows the stored language as selected', () => {
    setLanguageSetting('en');
    setup();
    expect(pill('English')).toHaveAttribute('aria-checked', 'true');
  });
});
