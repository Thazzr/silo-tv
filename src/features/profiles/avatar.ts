// Muted colours for the initial circle of a profile without an avatar image. Each keeps white
// text above 4.5:1; the same profile always gets the same colour.
const COLORS = ['#a63d52', '#2b7566', '#3a64a8', '#7b4ca6', '#8c6218', '#5b6572'] as const;

export function avatarColor(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return COLORS[hash % COLORS.length]!;
}
