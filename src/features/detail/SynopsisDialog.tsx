import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Focusable,
  FocusGroup,
  doesFocusableExist,
  getCurrentFocusKey,
  setFocus,
  type ArrowDirection,
} from '../../app/nav';
import { useT } from '../../i18n';

const CLOSE_KEY = 'synopsis-close';

/** One Up or Down press moves the text by three lines (36 px each, see src/styles/detail.css). */
export const SYNOPSIS_STEP = 108;

/**
 * The full text over a page (a synopsis, a biography). Close has the focus and the arrow keys
 * cannot leave the dialog; the page routes Back to `onClose`, and the focus returns to the button
 * that opened it. A text taller than the dialog scrolls with Up and Down, three lines a press: the
 * text is not focusable, so the dialog's arrow handler moves it (a transform, no layout), and a
 * soft fade at the top and the bottom says where more text follows.
 */
export function SynopsisDialog({
  title,
  text,
  onClose,
}: {
  title: string;
  text: string;
  onClose: () => void;
}) {
  const t = useT();
  const [previous] = useState(() => getCurrentFocusKey());

  useEffect(() => {
    void setFocus(CLOSE_KEY);
    return () => {
      if (previous && doesFocusableExist(previous)) void setFocus(previous);
    };
  }, [previous]);

  // --- Scrolling the text -----------------------------------------------------------------------
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const [offset, setOffset] = useState(0);
  // How far the text can move: its height beyond the box. Measured, since the box's height
  // follows the window and the font.
  const [max, setMax] = useState(0);
  const measure = useCallback(() => {
    const box = boxRef.current;
    const inner = textRef.current;
    if (!box || !inner) return;
    const next = Math.max(0, inner.offsetHeight - box.clientHeight);
    setMax(next);
    setOffset((old) => Math.min(old, next));
  }, []);
  useLayoutEffect(() => {
    measure();
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    // Fonts arriving or a different window size change the heights after the first measure.
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    if (textRef.current) observer.observe(textRef.current);
    return () => observer.disconnect();
  }, [measure, text]);

  const latest = useRef({ max });
  useEffect(() => {
    latest.current = { max };
  });
  const arrow = useCallback((direction: ArrowDirection) => {
    if (direction !== 'up' && direction !== 'down') return false;
    const delta = direction === 'down' ? SYNOPSIS_STEP : -SYNOPSIS_STEP;
    setOffset((old) => Math.max(0, Math.min(latest.current.max, old + delta)));
    // The press is decided here whether or not the text scrolls: there is nowhere else to go.
    return true;
  }, []);

  return (
    <div className="dialog-backdrop">
      <FocusGroup
        focusKey="synopsis-dialog"
        boundary
        autoRestoreFocus={false}
        onArrow={arrow}
        className="dialog dialog-synopsis"
        role="dialog"
        aria-modal="true"
        aria-labelledby="synopsis-title"
        data-testid="synopsis-dialog"
      >
        <h2 id="synopsis-title">{title}</h2>
        <div
          ref={boxRef}
          className="synopsis-scroll"
          data-testid="synopsis-scroll"
          data-more-above={offset > 0}
          data-more-below={offset < max}
        >
          <p
            ref={textRef}
            className="synopsis-full"
            data-testid="synopsis-full"
            style={{ transform: `translateY(${-offset}px)` }}
          >
            {text}
          </p>
        </div>
        <div className="dialog-actions">
          <Focusable focusKey={CLOSE_KEY} className="btn" onClick={onClose}>
            {t('detail.close')}
          </Focusable>
        </div>
      </FocusGroup>
    </div>
  );
}
