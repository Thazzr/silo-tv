// Finds machine-specific paths (a developer's profile or temp folder) in text. The public
// repository must never carry them. The patterns are assembled from pieces so that this file
// and its test do not contain a complete match themselves.

const SEP = '[\\\\/]+';
// Characters that rule out a URL or a longer word before a leading slash ("https://host/home/x/").
const NOT_AFTER = '(?<![A-Za-z0-9_.~:-])';

const RULES = [
  {
    name: 'windows user profile',
    re: new RegExp(`(?<![A-Za-z0-9])[A-Za-z]:${SEP}Us` + `ers${SEP}[^\\s\\\\/]+`),
  },
  { name: 'windows temp folder', re: new RegExp(`App` + `Data${SEP}Local${SEP}Temp`, 'i') },
  { name: 'macOS home', re: new RegExp(`${NOT_AFTER}/Us` + `ers/[^\\s/]+/`) },
  { name: 'linux home', re: new RegExp(`${NOT_AFTER}/ho` + `me/[^\\s/]+/`) },
];

/** Returns one finding per rule and offending line: { line (1-based), rule, text }. */
export function findLocalPaths(text) {
  const findings = [];
  text.split(/\r?\n/).forEach((content, index) => {
    for (const rule of RULES) {
      const match = rule.re.exec(content);
      if (match) findings.push({ line: index + 1, rule: rule.name, text: match[0] });
    }
  });
  return findings;
}
