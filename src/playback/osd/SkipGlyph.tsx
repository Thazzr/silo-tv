import { RotateCcw, RotateCw } from 'lucide-react';

/**
 * A skip button's glyph: Lucide's rotate arrow with the skip length as text over it, as Silo's web
 * player draws it. `forward` turns the arrow clockwise.
 */
export function SkipGlyph({ seconds, forward }: { seconds: number; forward: boolean }) {
  const Arrow = forward ? RotateCw : RotateCcw;
  return (
    <span className="player-skip-glyph">
      <Arrow size={54} strokeWidth={1.6} />
      <span className="player-skip-glyph-number" data-testid="player-skip-number">
        {seconds}
      </span>
    </span>
  );
}
