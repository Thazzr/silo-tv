import { useEffect, useMemo } from 'react';
import {
  Focusable,
  FocusGroup,
  doesFocusableExist,
  moveFocusTo,
  SelfFocusing,
  setFocus,
  type ArrowHandler,
} from '../../app/nav';
import { useT, type MessageKey } from '../../i18n';
import type { Chapter } from '../osd/previewMath';
import type { Heading, MediaFacts, Plan, ReplanResult } from '../usePlaybackSession';
import { ChaptersTab, chapterKey } from './ChaptersTab';
import { InfoTab } from './InfoTab';
import { currentChapter } from './info';
import { qualityMenu } from './qualityMenu';
import type { PanelState, PanelTab } from './usePanelState';
import { VideoTab, videoRowKeys } from './VideoTab';

const TAB_TEXT: Record<PanelTab, MessageKey> = {
  info: 'player.options.tab.info',
  video: 'player.options.tab.video',
  chapters: 'player.options.tab.chapters',
};

export const tabKey = (tab: PanelTab) => `player-opt-tab-${tab}`;

/**
 * Takes the focus when it mounts, on the row the viewer was on before the stream reloaded (when it
 * is still there), else on the active tab. It sits after the rows, so their effects (which
 * register them with the navigation) have run.
 */
function FocusOnMount({ recall, fallback }: { recall(): string | null; fallback: string }) {
  useEffect(() => {
    const remembered = recall();
    void setFocus(remembered && doesFocusableExist(remembered) ? remembered : fallback);
    // Once per mount: the panel claims the focus when it opens (or opens again after a reload).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export interface OptionsPanelProps {
  panel: PanelState;
  plan: Plan;
  media: MediaFacts;
  heading: Heading | null;
  title: string;
  chapters: readonly Chapter[];
  /** The playhead on the source's timeline. */
  position: number;
  /** The session's quality preference. */
  quality: string;
  activeQualityFeature: boolean;
  qualityChange(label: string): Promise<ReplanResult>;
  /** A chapter was chosen: seek to its start (source seconds); the panel closes. */
  onChapter(start: number): void;
}

/**
 * The player's options panel: a tab strip over the active tab's rows. Left and Right on the strip
 * show the next tab at once; Down enters its rows and Up from the first row comes back to the
 * active tab. Back and the media keys are the player's (usePlayerControls).
 */
export function OptionsPanel(props: OptionsPanelProps) {
  const { panel, plan, media, chapters } = props;
  const t = useT();

  const menu = useMemo(
    () => qualityMenu(plan, props.quality, props.activeQualityFeature),
    [plan, props.quality, props.activeQualityFeature],
  );
  // A tab without rows is not offered: the Video tab needs a quality choice or "Auto-play next".
  const hasVideoRows = videoRowKeys(menu, media.isEpisode).length > 0;
  const tabs = useMemo<PanelTab[]>(
    () => [
      'info',
      ...(hasVideoRows ? (['video'] as const) : []),
      ...(chapters.length > 0 ? (['chapters'] as const) : []),
    ],
    [hasVideoRows, chapters.length],
  );
  const active: PanelTab = tabs.includes(panel.tab) ? panel.tab : 'info';

  const rows =
    active === 'video'
      ? videoRowKeys(menu, media.isEpisode)
      : active === 'chapters'
        ? chapters.map((_, index) => chapterKey(index))
        : [];

  // Index navigation: the tabs and the rows know where each one is, so no spatial search runs.
  const onArrow: ArrowHandler = (direction, fromKey) => {
    const tab = tabs.find((id) => tabKey(id) === fromKey);
    if (tab) {
      const at = tabs.indexOf(tab);
      if (direction === 'left' || direction === 'right') {
        const next = tabs[at + (direction === 'right' ? 1 : -1)];
        return next ? moveFocusTo(tabKey(next)) : true;
      }
      return direction === 'down' && rows[0] ? moveFocusTo(rows[0]) : true;
    }
    const at = rows.indexOf(fromKey);
    if (at < 0) return true;
    if (direction === 'up') return moveFocusTo(at === 0 ? tabKey(active) : rows[at - 1]!);
    if (direction === 'down') return rows[at + 1] ? moveFocusTo(rows[at + 1]!) : true;
    return true;
  };

  const remember = panel.remember;

  return (
    <SelfFocusing>
      <FocusGroup
        focusKey="player-options"
        boundary
        autoRestoreFocus={false}
        className="player-options"
        role="dialog"
        aria-modal="true"
        aria-label={t('player.options.heading')}
        data-testid="player-options"
        onArrow={onArrow}
      >
        <div className="player-options-tabs" role="tablist">
          {tabs.map((id) => (
            <Focusable
              key={id}
              focusKey={tabKey(id)}
              role="tab"
              aria-selected={id === active}
              className="player-options-tab"
              data-testid={`options-tab-${id}`}
              onFocused={() => {
                remember(tabKey(id));
                panel.setTab(id);
              }}
              onClick={() => panel.setTab(id)}
            >
              {t(TAB_TEXT[id])}
            </Focusable>
          ))}
        </div>
        <div className="player-options-body">
          {active === 'info' ? (
            <InfoTab
              heading={props.heading}
              title={props.title}
              plan={plan}
              media={media}
              chapters={chapters}
              position={props.position}
            />
          ) : null}
          {active === 'video' ? (
            <VideoTab
              menu={menu}
              preference={props.quality}
              episode={media.isEpisode}
              qualityChange={props.qualityChange}
              onFocusKey={remember}
            />
          ) : null}
          {active === 'chapters' ? (
            <ChaptersTab
              chapters={chapters}
              current={currentChapter(chapters, props.position)}
              onChoose={props.onChapter}
              onFocusKey={remember}
            />
          ) : null}
        </div>
        <FocusOnMount recall={panel.recall} fallback={tabKey(active)} />
      </FocusGroup>
    </SelfFocusing>
  );
}
