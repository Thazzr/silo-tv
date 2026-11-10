// Plain inline icons for the player controls (our own drawings, no icon font to ship).
import type { ReactNode } from 'react';

function Icon({ children, size = 44 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const PlayIcon = () => (
  <Icon>
    <path d="M14 8v32l26-16z" />
  </Icon>
);

export const PauseIcon = () => (
  <Icon>
    <rect x="11" y="8" width="9" height="32" rx="2" />
    <rect x="28" y="8" width="9" height="32" rx="2" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path
      d="M12 12l24 24M36 12L12 36"
      stroke="currentColor"
      strokeWidth="5"
      strokeLinecap="round"
    />
  </Icon>
);

/** The mark of the checked row in a menu. */
export const CheckIcon = () => (
  <svg width="32" height="32" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path
      d="M10 25l9 9 19-20"
      fill="none"
      stroke="currentColor"
      strokeWidth="6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Three sliders: the options panel. */
export const OptionsIcon = () => (
  <Icon>
    <path
      d="M6 12h36M6 24h36M6 36h36"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
    />
    <circle cx="16" cy="12" r="5.5" stroke="currentColor" strokeWidth="3.5" fill="#000" />
    <circle cx="32" cy="24" r="5.5" stroke="currentColor" strokeWidth="3.5" fill="#000" />
    <circle cx="20" cy="36" r="5.5" stroke="currentColor" strokeWidth="3.5" fill="#000" />
  </Icon>
);

/** A circular arrow with the skip length inside; `forward` mirrors it. */
export function SkipIcon({ seconds, forward }: { seconds: number; forward: boolean }) {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true" focusable="false">
      <g transform={forward ? 'translate(56 0) scale(-1 1)' : undefined}>
        <path
          d="M28 9a19 19 0 1 1-19 19"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path d="M28 1v16l-11-8z" fill="currentColor" />
      </g>
      <text
        x="28"
        y="35"
        textAnchor="middle"
        fontSize="20"
        fontWeight="600"
        fill="currentColor"
        fontFamily="inherit"
      >
        {seconds}
      </text>
    </svg>
  );
}

/** Double chevron for the scrub readout; `forward` false points left. */
export function ScrubIcon({ forward }: { forward: boolean }) {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 48 48"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <g transform={forward ? undefined : 'translate(48 0) scale(-1 1)'}>
        <path d="M4 10v28l20-14zM24 10v28l20-14z" />
      </g>
    </svg>
  );
}
