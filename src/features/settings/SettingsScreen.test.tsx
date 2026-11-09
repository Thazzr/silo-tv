import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getResumeRewind, setResumeRewind } from '../../playback/resumeRewind';
import { KEY, pressKey } from '../../test/keys';
import { renderWithSilo } from '../../test/renderFlow';
import { SettingsScreen } from './SettingsScreen';

beforeEach(() => window.localStorage.clear());

function setup() {
  const onBack = vi.fn();
  const view = renderWithSilo(<SettingsScreen onBack={onBack} />);
  return { onBack, ...view };
}

const pill = (name: string) => screen.getByRole('radio', { name });

describe('SettingsScreen', () => {
  it('shows the title, the section, the setting and its pills', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Playback' })).toBeInTheDocument();
    expect(screen.getByText('Rewind on resume')).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((p) => p.textContent)).toEqual([
      'Off',
      '5 s',
      '7 s',
      '10 s',
      '15 s',
      '20 s',
      '30 s',
    ]);
  });

  it('focuses the selected pill (7 s by default) and marks it', async () => {
    setup();
    await waitFor(() => expect(pill('7 s')).toHaveFocus());
    expect(pill('7 s')).toHaveAttribute('aria-checked', 'true');
    expect(pill('7 s')).toHaveClass('selected');
    expect(pill('10 s')).toHaveAttribute('aria-checked', 'false');
  });

  it('focuses the stored value when it is a choice', async () => {
    setResumeRewind(20);
    setup();
    await waitFor(() => expect(pill('20 s')).toHaveFocus());
    expect(pill('20 s')).toHaveClass('selected');
  });

  it('marks no pill for a stored value that is not a choice, and still applies it', async () => {
    setResumeRewind(12);
    setup();
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('radio'));
    expect(document.querySelectorAll('.settings-pill.selected')).toHaveLength(0);
    expect(getResumeRewind()).toBe(12);
  });

  it('arrow keys alone move the highlight and never change the value', async () => {
    setup();
    await waitFor(() => expect(pill('7 s')).toHaveFocus());
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
    await waitFor(() => expect(pill('7 s')).toHaveFocus());
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    expect(pill('15 s')).toHaveFocus();
    await pressKey(KEY.enter);
    expect(pill('15 s')).toHaveClass('selected');
    expect(pill('7 s')).not.toHaveClass('selected');
    expect(window.localStorage.getItem('silo-tv.settings.resumeRewindSeconds')).toBe('15');
    expect(getResumeRewind()).toBe(15);
  });

  it('Off stores 0', async () => {
    setup();
    fireEvent.click(pill('Off'));
    expect(getResumeRewind()).toBe(0);
    expect(pill('Off')).toHaveClass('selected');
  });

  it('hover only moves the highlight; a click selects', async () => {
    setup();
    await waitFor(() => expect(pill('7 s')).toHaveFocus());
    fireEvent.mouseEnter(pill('30 s'));
    await waitFor(() => expect(pill('30 s')).toHaveFocus());
    expect(getResumeRewind()).toBe(7);
    expect(pill('30 s')).not.toHaveClass('selected');
    fireEvent.click(pill('30 s'));
    expect(getResumeRewind()).toBe(30);
    expect(pill('30 s')).toHaveClass('selected');
  });

  it('Back leaves the screen', async () => {
    const { onBack } = setup();
    await waitFor(() => expect(pill('7 s')).toHaveFocus());
    await pressKey(KEY.back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
