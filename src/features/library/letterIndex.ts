// The letter index of a title-ordered list: where each block of titles under one letter starts.
// The rail's jump marks and its active letter are read from it.

export interface LetterRun {
  letter: string;
  /** Zero-based list position of the block's first title. */
  position: number;
}

export interface LetterIndex {
  /** The letters that have titles. */
  lit: ReadonlySet<string>;
  /** The blocks in list order. A letter can have several: the collation may split it. */
  runs: readonly LetterRun[];
  /** Titles in the whole list; the grid's length. */
  total: number;
}

/**
 * The letter whose titles the list shows at `index`: the letter of the last run that starts at or
 * before it. Runs rather than each letter's first position, because a collation can sort some of
 * a letter's titles apart from the rest.
 */
export function letterAtIndex(runs: readonly LetterRun[], index: number): string | undefined {
  let current: LetterRun | undefined;
  for (const run of runs) {
    if (run.position > index) break;
    current = run;
  }
  return current?.letter;
}

/** Where a jump to `letter` lands: the first title of its first run in list order. */
export function jumpPosition(runs: readonly LetterRun[], letter: string): number | undefined {
  return runs.find((run) => run.letter === letter)?.position;
}
