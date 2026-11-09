import { describe, expect, it } from 'vitest';
import { resumePoint, rewound } from './resume';

describe('resumePoint', () => {
  it('is null at or below 30 s and the position past it', () => {
    expect(resumePoint({ position_seconds: 30, duration_seconds: 5400 })).toBeNull();
    expect(resumePoint({ position_seconds: 31, duration_seconds: 5400 })).toBe(31);
    expect(resumePoint({ position_seconds: 600.9, duration_seconds: 5400 })).toBe(600);
  });

  it('is null within 5 s of the end', () => {
    expect(resumePoint({ position_seconds: 5395, duration_seconds: 5400 })).toBeNull();
    expect(resumePoint({ position_seconds: 5394, duration_seconds: 5400 })).toBe(5394);
  });

  it('measures the end by the fallback runtime when the state has no duration', () => {
    expect(resumePoint({ position_seconds: 2398 }, 2400)).toBeNull();
    expect(resumePoint({ position_seconds: 1200 }, 2400)).toBe(1200);
    expect(resumePoint({ position_seconds: 1200 })).toBe(1200);
  });

  it('resumes a rewatch that stopped partway although the server counts the item played', () => {
    expect(
      resumePoint({ position_seconds: 900, duration_seconds: 5400, ...{ played: true } }),
    ).toBe(900);
  });

  it('is null without a watch state', () => {
    expect(resumePoint(undefined)).toBeNull();
    expect(resumePoint({})).toBeNull();
  });
});

describe('resumePoint of a rewatch', () => {
  it('resumes a played item that has a saved position (the TV finding)', () => {
    expect(
      resumePoint({ position_seconds: 362.464, duration_seconds: 3514, ...{ played: true } }),
    ).toBe(362);
  });
});

describe('rewound', () => {
  it('moves the point back by the rewind', () => {
    expect(rewound(362, 15)).toBe(347);
    expect(rewound(362, 0)).toBe(362);
  });

  it('never goes below the start', () => {
    expect(rewound(10, 30)).toBe(0);
  });
});
