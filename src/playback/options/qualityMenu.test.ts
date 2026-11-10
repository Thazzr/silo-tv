import { describe, expect, it } from 'vitest';
import type { components } from '../../api/generated/schema';
import { AUTO, changesQuality, isSourceAlias, qualityMenu } from './qualityMenu';

type Rung = components['schemas']['AvailableQualityV3'];

const rung = (label: string, extra: Partial<Rung> = {}): Rung => ({
  label,
  preserves_source: false,
  ...extra,
});

const RUNGS = [rung('1080p', { display_name: '1080p (8 Mbps)' }), rung('720p'), rung('480p')];

function menu(
  preference: string,
  options: { available?: Rung[]; active?: string; feature?: boolean } = {},
) {
  return qualityMenu(
    { available_qualities: options.available ?? RUNGS, active_quality: options.active },
    preference,
    options.feature ?? false,
  );
}

describe('the rows', () => {
  it.each(['auto', 'Original', 'SOURCE', ' max '])('leaves out the source alias %j', (alias) => {
    const rows = menu('auto', { available: [rung(alias), rung('720p')] })?.rows;
    expect(rows).toEqual([{ label: '720p', name: '720p' }]);
    expect(isSourceAlias(alias)).toBe(true);
  });

  it('leaves out a repeated label and keeps the first one', () => {
    const rows = menu('auto', {
      available: [rung('720p', { display_name: 'HD' }), rung('480p'), rung('720p')],
    })?.rows;
    expect(rows).toEqual([
      { label: '720p', name: 'HD' },
      { label: '480p', name: '480p' },
    ]);
  });

  it('names a row by its display name, else its label (an empty display name is none)', () => {
    const rows = menu('auto', {
      available: [
        rung('1080p', { display_name: '1080p (8 Mbps)' }),
        rung('720p', { display_name: '' }),
      ],
    })?.rows;
    expect(rows?.map((row) => row.name)).toEqual(['1080p (8 Mbps)', '720p']);
  });

  it('is hidden for a plan that lacks the list altogether', () => {
    const plan = {} as Parameters<typeof qualityMenu>[0];
    expect(qualityMenu(plan, 'auto', false)).toBeNull();
  });

  it('is hidden when the plan offers no choice besides Auto', () => {
    expect(menu('auto', { available: [] })).toBeNull();
    expect(menu('auto', { available: [rung('original'), rung('Auto')] })).toBeNull();
  });
});

describe('the checked row', () => {
  it.each(['auto', 'original', 'Source', 'max'])(
    'is Auto when the preference is %j, whatever the plan reports',
    (preference) => {
      const result = menu(preference, { active: '720p', feature: true });
      expect(result?.checked).toBe(AUTO);
      expect(result?.unmatched).toBeNull();
    },
  );

  it('is the row active_quality names when the server advertises the feature', () => {
    const result = menu('1080p', { active: '720p', feature: true });
    expect(result?.checked).toBe('720p');
    expect(result?.unmatched).toBeNull();
  });

  it('ignores active_quality when the server does not advertise the feature', () => {
    // Falls to the exact match of the preference.
    expect(menu('1080p', { active: '720p', feature: false })?.checked).toBe('1080p');
  });

  it('ignores an active_quality that is no row, or absent', () => {
    expect(menu('480p', { active: '360p', feature: true })?.checked).toBe('480p');
    expect(menu('480p', { feature: true })?.checked).toBe('480p');
  });

  it('is the row whose label is the preference', () => {
    expect(menu('720p')?.checked).toBe('720p');
  });

  it('is no row when nothing matches, and the heading names the preference', () => {
    const result = menu('2160p');
    expect(result?.checked).toBeNull();
    expect(result?.unmatched).toBe('2160p');
    // A plan that reports a rung nothing in the menu matches changes nothing.
    expect(menu('2160p', { active: '360p', feature: true })?.checked).toBeNull();
  });
});

describe('whether a pick changes anything', () => {
  it('does nothing for the checked row, and for the preference the session already has', () => {
    const m = menu('720p')!;
    expect(changesQuality(m, '720p', '720p')).toBe(false);
    expect(changesQuality(m, '720p', '480p')).toBe(true);
    expect(changesQuality(m, '720p', AUTO)).toBe(true);
    // Active quality checks 1080p while the preference is 720p: choosing the preference is moot.
    const active = menu('720p', { active: '1080p', feature: true })!;
    expect(active.checked).toBe('1080p');
    expect(changesQuality(active, '720p', '1080p')).toBe(false);
    expect(changesQuality(active, '720p', '720p')).toBe(false);
  });

  it('does nothing for Auto under an Auto preference, also under an alias', () => {
    expect(changesQuality(menu('auto')!, 'auto', AUTO)).toBe(false);
    expect(changesQuality(menu('original')!, 'original', AUTO)).toBe(false);
    expect(changesQuality(menu('auto')!, 'auto', '720p')).toBe(true);
  });

  it('changes to Auto from a plain resolution the profile prefers, which no row checks', () => {
    const m = menu('2160p')!;
    expect(changesQuality(m, '2160p', AUTO)).toBe(true);
  });
});
