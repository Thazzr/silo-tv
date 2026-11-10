// The Quality section of the settings menu, as pure rules: which rows it lists, which one is
// checked and whether a pick changes anything. The menu only draws what this decides.
import type { Plan } from '../session/types';

/** The "Auto" row, which stands for the source (the `auto` preference). */
export const AUTO = 'auto';

/** Labels that mean "the source": the Auto row covers them, so they get no row of their own. */
const SOURCE_ALIASES = new Set(['auto', 'original', 'source', 'max']);

export const isSourceAlias = (label: string): boolean =>
  SOURCE_ALIASES.has(label.trim().toLowerCase());

export interface QualityRow {
  /** What a replan sends. */
  label: string;
  /** What the row shows: the server's display name, else the label. */
  name: string;
  /** The rung's bitrate, when the server names one. */
  bitrateKbps?: number;
}

export interface QualityMenu {
  /** The choices after Auto, in the server's order. */
  rows: QualityRow[];
  /** `AUTO`, a row's label, or null when no row is checked. */
  checked: string | null;
  /** The preference's own name, for the heading and the gear's label when no row is checked. */
  unmatched: string | null;
}

/**
 * The menu for a plan, or null when the plan offers no choice besides Auto (the section is then
 * left out). The checked row is the first rule that applies:
 * 1. Auto, when the preference is `auto` or another name for the source;
 * 2. the row `plan.active_quality` names, when the server advertises `plan_active_quality_v1`;
 * 3. the row whose label is the preference;
 * 4. none, and the heading names the preference instead.
 */
export function qualityMenu(
  plan: Pick<Plan, 'available_qualities' | 'active_quality'>,
  preference: string,
  activeQualityFeature: boolean,
): QualityMenu | null {
  const rows: QualityRow[] = [];
  // The field is required, but a plan without it must not take the panel down: no choice then.
  for (const quality of plan.available_qualities ?? []) {
    if (isSourceAlias(quality.label) || rows.some((row) => row.label === quality.label)) continue;
    rows.push({
      label: quality.label,
      name: quality.display_name || quality.label,
      ...(quality.bitrate_kbps ? { bitrateKbps: quality.bitrate_kbps } : {}),
    });
  }
  if (rows.length === 0) return null;

  const has = (label: string | undefined) => rows.some((row) => row.label === label);
  const active = activeQualityFeature ? plan.active_quality : undefined;
  let checked: string | null = null;
  if (isSourceAlias(preference)) checked = AUTO;
  else if (has(active)) checked = active!;
  else if (has(preference)) checked = preference;
  return { rows, checked, unmatched: checked === null ? preference : null };
}

/**
 * Whether choosing `target` (a row's label, or `AUTO`) changes anything: not for the checked row
 * and not for the preference the session already has.
 */
export function changesQuality(menu: QualityMenu, preference: string, target: string): boolean {
  if (target === menu.checked) return false;
  return target !== preference && !(target === AUTO && isSourceAlias(preference));
}

/**
 * What the settings button says about the quality: Auto, the checked row's name, or the
 * preference's own name when no row is checked.
 */
export function qualityLabel(
  menu: QualityMenu,
  preference: string,
): { kind: 'auto' } | { kind: 'name'; name: string } {
  if (menu.checked === AUTO) return { kind: 'auto' };
  const row = menu.rows.find((item) => item.label === menu.checked);
  return { kind: 'name', name: row ? row.name : preference };
}

/** "3 Mbps", "3.5 Mbps" or "800 kbps" (decimal comma in German); null when unknown. */
export function formatBitrate(kbps: number | undefined, decimal = '.'): string | null {
  if (!kbps || kbps <= 0) return null;
  if (kbps < 1000) return `${Math.round(kbps)} kbps`;
  const mbps = Math.round(kbps / 100) / 10;
  return `${String(mbps).replace('.', decimal)} Mbps`;
}
