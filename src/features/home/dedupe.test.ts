import { describe, expect, it } from 'vitest';
import { catalogItem } from '../../test/flowFixtures';
import { homeSection } from '../../test/homeFixtures';
import { dropDuplicateCards } from './dedupe';

const shared = catalogItem({ content_id: 'x', title: 'Shared' });
const own = (id: string) => catalogItem({ content_id: id, title: id });
const avoiding = (...types: string[]) => new Set(types);
const ids = (section: { items: { content_id: string }[] }) =>
  section.items.map((item) => item.content_id);

describe('dropDuplicateCards', () => {
  it('drops from a marked section a card an earlier section shows', () => {
    const top = homeSection('top', 0, { items: [shared, own('a')] });
    const low = homeSection('low', 0, { section_type: 'marked', items: [shared, own('b')] });
    const [, result] = dropDuplicateCards([top, low], avoiding('marked'));
    expect(ids(result!)).toEqual(['b']);
  });

  it('lets the layout order decide which of two sections keeps the card', () => {
    const marked = homeSection('m', 0, { section_type: 'marked', items: [shared, own('a')] });
    const plain = homeSection('p', 0, { items: [shared] });
    const [first, second] = dropDuplicateCards([marked, plain], avoiding('marked'));
    expect(ids(first!)).toEqual(['x', 'a']);
    expect(ids(second!)).toEqual(['x']);
    const [plainFirst, markedSecond] = dropDuplicateCards([plain, marked], avoiding('marked'));
    expect(ids(plainFirst!)).toEqual(['x']);
    expect(ids(markedSecond!)).toEqual(['a']);
  });

  it('leaves a section of an unmarked type whole', () => {
    const top = homeSection('top', 0, { items: [shared] });
    const low = homeSection('low', 0, { section_type: 'other', items: [shared] });
    const [, result] = dropDuplicateCards([top, low], avoiding('marked'));
    expect(ids(result!)).toEqual(['x']);
  });

  it('lets an unmarked section mark its cards as seen for a later marked one', () => {
    const top = homeSection('top', 0, { section_type: 'other', items: [shared] });
    const low = homeSection('low', 0, { section_type: 'marked', items: [shared, own('b')] });
    const [, result] = dropDuplicateCards([top, low], avoiding('marked'));
    expect(ids(result!)).toEqual(['b']);
  });

  it('never drops a card without a content_id', () => {
    const blank = { ...own('a'), content_id: '' };
    const top = homeSection('top', 0, { items: [blank] });
    const low = homeSection('low', 0, { section_type: 'marked', items: [blank] });
    const [, result] = dropDuplicateCards([top, low], avoiding('marked'));
    expect(result!.items).toHaveLength(1);
  });

  it('reduces total_count by what was dropped, never below what the section still shows', () => {
    const top = homeSection('top', 0, { items: [shared, own('a')] });
    const low = homeSection('low', 0, {
      section_type: 'marked',
      items: [shared, own('a'), own('b')],
      total_count: 10,
    });
    const tiny = homeSection('tiny', 0, {
      section_type: 'marked',
      items: [shared, own('c')],
      total_count: 1,
    });
    const [, lower, small] = dropDuplicateCards([top, low, tiny], avoiding('marked'));
    expect(lower!.total_count).toBe(8);
    expect(small!.total_count).toBe(1);
  });

  it('keeps the identity of a section that lost nothing', () => {
    const top = homeSection('top', 2);
    const low = homeSection('low', 2, { section_type: 'marked' });
    const result = dropDuplicateCards([top, low], avoiding('marked'));
    expect(result[0]).toBe(top);
    expect(result[1]).toBe(low);
  });

  it('returns the sections as served when no type is marked', () => {
    const sections = [
      homeSection('top', 0, { items: [shared] }),
      homeSection('low', 0, { items: [shared] }),
    ];
    expect(dropDuplicateCards(sections, avoiding())).toBe(sections);
  });
});
