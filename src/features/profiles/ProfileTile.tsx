import { useState, type ReactNode } from 'react';
import { useSilo } from '../../app/SiloContext';
import { Focusable } from '../../app/nav';
import { useT } from '../../i18n';
import { initialOf, resolveAssetUrl } from '../branding/branding';
import { avatarColor } from './avatar';
import type { Profile } from './queries';

interface TileProps {
  focusKey: string;
  focused: boolean;
  autoFocus: boolean;
  onFocused: () => void;
  onBlurred: () => void;
  onClick: () => void;
}

function Tile({
  focusKey,
  focused,
  autoFocus,
  onFocused,
  onBlurred,
  onClick,
  name,
  children,
}: TileProps & { name: string; children: ReactNode }) {
  return (
    <Focusable
      focusKey={focusKey}
      autoFocus={autoFocus}
      className={focused ? 'profile-tile is-focused' : 'profile-tile'}
      onFocused={onFocused}
      onBlur={onBlurred}
      onClick={onClick}
    >
      {children}
      <span className="tile-name">{name}</span>
    </Focusable>
  );
}

/** One profile of the picker: avatar image or initial, name, and the lock and Kids badges. */
export function ProfileTile({ profile, ...tile }: TileProps & { profile: Profile }) {
  const t = useT();
  const { baseUrl } = useSilo();
  const url = resolveAssetUrl(baseUrl, profile.avatar_url);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = url !== null && failedUrl !== url;
  return (
    <Tile {...tile} name={profile.name}>
      <span className="tile-avatar">
        {showImage ? (
          <img
            src={url}
            alt=""
            data-testid="profile-avatar-image"
            onError={() => setFailedUrl(url)}
          />
        ) : (
          <span
            className="tile-initial"
            aria-hidden="true"
            data-testid="profile-avatar-initial"
            style={{ background: avatarColor(profile.id || profile.name) }}
          >
            {initialOf(profile.name)}
          </span>
        )}
        {profile.is_child ? (
          <span className="tile-badge kids" data-testid="kids-badge">
            {t('profiles.kids')}
          </span>
        ) : null}
        {profile.has_pin ? (
          <svg
            className="tile-badge lock"
            viewBox="0 0 24 24"
            role="img"
            aria-label={t('profiles.pinLocked')}
            data-testid="lock-badge"
          >
            <path
              fill="currentColor"
              d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm3 8H9V7a3 3 0 0 1 6 0v3Z"
            />
          </svg>
        ) : null}
      </span>
    </Tile>
  );
}

/** The last tile of the picker: opens the new-profile form. */
export function AddProfileTile(tile: TileProps) {
  const t = useT();
  return (
    <Tile {...tile} name={t('profiles.add')}>
      <span className="tile-avatar add" aria-hidden="true">
        <span className="tile-plus" data-testid="add-profile-plus">
          +
        </span>
      </span>
    </Tile>
  );
}
