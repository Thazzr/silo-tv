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

/** A cog with eight teeth and a hole: the settings menu. */
export const GearIcon = () => (
  <Icon size={40}>
    <path
      fillRule="evenodd"
      d="M20.6 9.4 L21.1 3.7 L26.9 3.7 L27.4 9.4 L31.9 11.3 L36.3 7.6 L40.4 11.7 L36.7 16.1 L38.6 20.6 L44.3 21.1 L44.3 26.9 L38.6 27.4 L36.7 31.9 L40.4 36.3 L36.3 40.4 L31.9 36.7 L27.4 38.6 L26.9 44.3 L21.1 44.3 L20.6 38.6 L16.1 36.7 L11.7 40.4 L7.6 36.3 L11.3 31.9 L9.4 27.4 L3.7 26.9 L3.7 21.1 L9.4 20.6 L11.3 16.1 L7.6 11.7 L11.7 7.6 L16.1 11.3Z M31 24a7 7 0 1 0-14 0a7 7 0 1 0 14 0Z"
    />
  </Icon>
);

/** An "i" in a circle: the playback info. */
export const InfoIcon = () => (
  <Icon size={40}>
    <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="4" />
    <rect x="21.5" y="21" width="5" height="14" rx="2" />
    <circle cx="24" cy="14.5" r="3" />
  </Icon>
);

/** A list with bullets: the chapters. */
export const ChaptersIcon = () => (
  <Icon size={40}>
    <path
      d="M18 12h24M18 24h24M18 36h24"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
    />
    <circle cx="8" cy="12" r="3" />
    <circle cx="8" cy="24" r="3" />
    <circle cx="8" cy="36" r="3" />
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
