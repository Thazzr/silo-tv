import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getCurrentFocusKey, setFocus } from '../../app/nav';
import { catalogItem } from '../../test/flowFixtures';
import { KEY, pressKey } from '../../test/keys';
import { renderWithSilo } from '../../test/renderFlow';
import { HERO_RETRY_KEY } from './Carousel';
import { Hero } from './Hero';

describe('Hero: the featured section is loading', () => {
  it('shows a hero-sized skeleton in the carousel mode', () => {
    renderWithSilo(<Hero item={null} featured={{ kind: 'loading' }} />);
    const skeleton = screen.getByTestId('hero-skeleton');
    expect(skeleton).toHaveClass('hero');
    expect(skeleton.querySelectorAll('.skeleton-bar')).toHaveLength(3);
  });

  it('shows the focused card instead while the focus is in the rows', () => {
    renderWithSilo(
      <Hero
        item={catalogItem({ content_id: 'c1', title: 'Heat' })}
        featured={{ kind: 'loading' }}
      />,
    );
    expect(screen.queryByTestId('hero-skeleton')).toBeNull();
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Heat');
  });
});

describe('Hero: the featured section could not be read', () => {
  const failed = (onRetry = vi.fn()) =>
    renderWithSilo(<Hero item={null} featured={{ kind: 'error', text: 'hero.failed', onRetry }} />);

  it('shows the web message and "Retry section" in the hero\'s place', () => {
    failed();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This featured section could not be loaded right now.',
    );
    expect(screen.getByRole('button', { name: 'Retry section' })).toBeInTheDocument();
  });

  it("says it in the library's words when the library asks", () => {
    renderWithSilo(
      <Hero
        item={null}
        featured={{ kind: 'error', text: 'hero.failedLibrary', onRetry: vi.fn() }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The featured section could not be loaded right now.',
    );
  });

  it('can be focused, and OK on "Retry section" reads the section again', async () => {
    const onRetry = vi.fn();
    failed(onRetry);
    await act(async () => {
      await setFocus(HERO_RETRY_KEY);
    });
    expect(getCurrentFocusKey()).toBe(HERO_RETRY_KEY);
    await pressKey(KEY.enter);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
