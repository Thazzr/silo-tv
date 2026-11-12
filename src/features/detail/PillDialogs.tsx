import { useEffect } from 'react';
import { useLanguage, useT } from '../../i18n';
import { ChoiceDialog, type Choice } from './ChoiceDialog';
import { videoRangeLabel } from './info';
import { editionDetail, versionDetail, versionLabel, type SubtitleRow } from './pills';
import type { PillKind } from './PillsRow';
import type { Pills } from './usePicks';

/** The choice to start on: the checked one when the list has it, else the first. */
const startOn = (choices: readonly Choice[]) =>
  choices.find((choice) => choice.checked)?.key ?? choices[0]!.key;

/**
 * The list a pill opens, in the dialog host of the action row: the TV form of the web's popover.
 * A pick applies at once and closes the list; the focus goes back to the pill.
 */
export function PillDialog({
  kind,
  pills,
  onClose,
}: {
  kind: PillKind;
  pills: Pills;
  onClose: () => void;
}) {
  switch (kind) {
    case 'edition':
      return <EditionDialog pills={pills} onClose={onClose} />;
    case 'version':
      return <VersionDialog pills={pills} onClose={onClose} />;
    case 'audio':
      return <AudioDialog pills={pills} onClose={onClose} />;
    case 'subtitles':
      return <SubtitleDialog pills={pills} onClose={onClose} />;
  }
}

function EditionDialog({ pills, onClose }: { pills: Pills; onClose: () => void }) {
  const t = useT();
  const { options, current } = pills.picker.editions!;
  const choices: Choice[] = options.map((option) => ({
    key: `detail-edition-${option.id}`,
    label: option.label,
    description: editionDetail(option.versions.length, option.defaultVersion, t),
    checked: option.id === current.id,
    onSelect: () => {
      pills.selectVersion(option.defaultVersion.file_id);
      onClose();
    },
  }));
  return (
    <ChoiceDialog
      testId="pill-edition-dialog"
      label={t('detail.pill.edition')}
      title={t('detail.pill.edition')}
      choices={choices}
      initialKey={startOn(choices)}
      onClose={onClose}
    />
  );
}

function VersionDialog({ pills, onClose }: { pills: Pills; onClose: () => void }) {
  const t = useT();
  const lang = useLanguage();
  const { version } = pills;
  const choices: Choice[] = pills.picker.versions!.map((one) => {
    const range = videoRangeLabel(one);
    return {
      key: `detail-version-${one.file_id}`,
      label: versionLabel(one, lang, t),
      badges: range ? [{ text: range }] : undefined,
      description: versionDetail(one, lang) || undefined,
      checked: one.file_id === version.file_id,
      onSelect: () => {
        pills.selectVersion(one.file_id);
        onClose();
      },
    };
  });
  return (
    <ChoiceDialog
      testId="pill-version-dialog"
      label={t('detail.pill.version')}
      title={t('detail.pill.version')}
      choices={choices}
      initialKey={startOn(choices)}
      onClose={onClose}
    />
  );
}

function AudioDialog({ pills, onClose }: { pills: Pills; onClose: () => void }) {
  const t = useT();
  const audio = pills.audio!;
  const choices: Choice[] = [
    {
      key: 'detail-audio-auto',
      label: t('detail.pill.auto'),
      description: audio.autoDescription,
      checked: audio.checked === null,
      onSelect: () => {
        audio.reset();
        onClose();
      },
    },
    ...audio.rows.map((row): Choice => ({
      key: `detail-audio-${row.index}`,
      label: row.title,
      badges: [
        ...(row.codec ? [{ text: row.codec }] : []),
        ...(row.channels ? [{ text: row.channels }] : []),
        ...(row.isDefault ? [{ text: t('player.menu.audio.default'), outlined: true }] : []),
      ],
      description: row.meta || undefined,
      checked: audio.checked === row.index,
      onSelect: () => {
        audio.pick(row.index);
        onClose();
      },
    })),
  ];
  return (
    <ChoiceDialog
      testId="pill-audio-dialog"
      label={t('detail.pill.audio')}
      title={t('detail.pill.audio')}
      choices={choices}
      initialKey={startOn(choices)}
      onClose={onClose}
    />
  );
}

function SubtitleDialog({ pills, onClose }: { pills: Pills; onClose: () => void }) {
  const t = useT();
  const { subtitles } = pills;
  const { load, lists, checked } = subtitles;
  // The downloaded subtitles are read when the list opens.
  useEffect(load, [load]);

  const done = (action: () => void) => () => {
    action();
    onClose();
  };
  const row = (one: SubtitleRow, section: string): Choice => ({
    key: `detail-subtitle-${one.key}`,
    label: one.language,
    section,
    badges: [
      ...(one.format ? [{ text: one.format }] : []),
      ...(one.forced ? [{ text: t('detail.pill.forced'), outlined: true }] : []),
      ...(one.hearingImpaired ? [{ text: t('detail.pill.sdh'), outlined: true }] : []),
      ...(one.isDefault ? [{ text: t('player.menu.audio.default'), outlined: true }] : []),
    ],
    description: one.description ?? undefined,
    checked: checked.mode === 'track' && checked.key === one.key,
    onSelect: done(() => subtitles.pick(one)),
  });
  const choices: Choice[] = [
    {
      key: 'detail-subtitle-auto',
      label: t('detail.pill.auto'),
      description: subtitles.autoDescription,
      checked: checked.mode === 'auto',
      onSelect: done(subtitles.reset),
    },
    {
      key: 'detail-subtitle-off',
      label: t('player.menu.subtitles.off'),
      checked: checked.mode === 'off',
      onSelect: done(subtitles.off),
    },
    ...lists.embedded.map((one) => row(one, t('player.menu.subtitles.source.embedded'))),
    ...lists.external.map((one) => row(one, t('player.menu.subtitles.source.external'))),
    ...lists.downloaded.map((one) => row(one, t('player.menu.subtitles.source.downloaded'))),
  ];
  let note;
  if (subtitles.loading) note = { text: t('detail.pill.loadingDownloaded'), busy: true };
  else if (lists.all.length === 0) note = { text: t('detail.pill.noSubtitles') };
  return (
    <ChoiceDialog
      testId="pill-subtitles-dialog"
      label={t('detail.pill.subtitles')}
      title={t('detail.pill.subtitles')}
      choices={choices}
      initialKey={startOn(choices)}
      note={note}
      onClose={onClose}
    />
  );
}
