/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Screens build from the component library in src/ui (ARCHITECTURE.md "UI"). This test is
 * silent until a screen bypasses it: a raw touchable / switch / Text, a hard-coded colour,
 * font size, or spacing off the 4-pt grid. Fix it by using (or adding) a src/ui component or a
 * token, or mark the line with `// ui-exception: <why>` (or the whole file, in its first
 * 10 lines, with `// ui-exception-file: <why>`). src/ui itself is the library and is exempt.
 */
const ROOT = join(__dirname, '..');
const DIRS = ['src/app', 'src/features'];

const RULES: { name: string; test: (line: string) => boolean; fix: string }[] = [
  {
    name: 'raw react-native control',
    test: (l) =>
      /\b(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|Switch|Text|TextInput|Button)\b/.test(
        l,
      ),
    fix: 'use Tappable / Button / TextButton / ListRow / SwitchRow / AppText / TextField from @/ui',
  },
  {
    name: 'hard-coded colour',
    test: (l) =>
      /['"`]#[0-9a-fA-F]{3,8}['"`]/.test(l) ||
      /\brgba?\(/.test(l) ||
      /\bcolor:\s*['"](white|black|red|green|blue|gray|grey)['"]/.test(l),
    fix: 'use a colour role from useColors() / makeStyles',
  },
  {
    name: 'raw font size',
    test: (l) => /\b(fontSize|lineHeight|fontWeight):\s*['"]?\d/.test(l),
    fix: 'use <AppText variant=…> (type scale in src/ui/tokens.ts)',
  },
  {
    name: 'spacing off the 4-pt grid',
    test: (l) =>
      [
        ...l.matchAll(
          /\b(?:padding|margin|gap|rowGap|columnGap)(?:Top|Bottom|Left|Right|Horizontal|Vertical|Start|End)?:\s*(-?\d+(?:\.\d+)?)\b/g,
        ),
      ].some((m) => Number(m[1]) % 4 !== 0 && Math.abs(Number(m[1])) > 2),
    fix: 'use space.* from @/ui',
  },
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(n) ? [p] : [];
  });
}

/** Lines of a file that a rule applies to: rule 1 looks only at react-native imports. */
function rnImportLines(src: string): Set<number> {
  const out = new Set<number>();
  const re = /import\s*\{([^}]*)\}\s*from\s*'react-native'/g;
  for (const m of src.matchAll(re)) {
    const start = src.slice(0, m.index).split('\n').length - 1;
    const end = start + m[0].split('\n').length - 1;
    for (let i = start; i <= end; i++) out.add(i);
  }
  return out;
}

const EXC = /\/\/\s*ui-exception:\s*(\S.*)?$/;
const FILE_EXC = /\/\/\s*ui-exception-file:\s*(\S.*)?$/;

export function violations(path: string, src: string): string[] {
  const lines = src.split('\n');
  const out: string[] = [];
  const head = lines.slice(0, 10).map((l) => l.match(FILE_EXC));
  if (head.some((m) => m && !m[1])) out.push(`${path}: ui-exception-file needs a reason`);
  if (head.some((m) => m && m[1])) return out;
  const rn = rnImportLines(src);
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
    const hits = RULES.filter((r, k) => (k === 0 ? rn.has(i) : true) && r.test(code));
    if (!hits.length) return;
    const exc = line.match(EXC) ?? lines[i - 1]?.match(EXC);
    if (exc && exc[1]) return;
    for (const r of hits) {
      out.push(`${path}:${i + 1} ${r.name} — ${r.fix}${exc ? ' (exception needs a reason)' : ''}`);
    }
  });
  return out;
}

describe('UI conventions', () => {
  it('screens use src/ui components and tokens (or say why not)', () => {
    const all = DIRS.flatMap((d) => files(join(ROOT, d))).flatMap((p) =>
      violations(relative(ROOT, p), readFileSync(p, 'utf8')),
    );
    expect(all).toEqual([]);
  });

  it('catches each kind of bypass and honours exceptions with reasons', () => {
    const v = (s: string) => violations('x.tsx', s);
    expect(v("import { Pressable, View } from 'react-native';")).toHaveLength(1);
    expect(v("import { TextInput, View } from 'react-native';")).toHaveLength(1);
    expect(v("import { ScrollView, View } from 'react-native';")).toEqual([]);
    expect(v("const a = { color: '#fff' };")).toHaveLength(1);
    expect(v('const a = { fontSize: 13 };')).toHaveLength(1);
    expect(v('const a = { padding: 10 };')).toHaveLength(1);
    expect(v('const a = { padding: 12, gap: space.sm, margin: 2 };')).toEqual([]);
    expect(v("const a = { color: '#000' }; // ui-exception: video overlay")).toEqual([]);
    expect(v("// ui-exception: video overlay\nconst a = { color: '#000' };")).toEqual([]);
    expect(v("const a = { color: '#000' }; // ui-exception:")).toHaveLength(1);
    expect(v("// ui-exception-file: camera viewfinder\nconst a = { color: '#000' };")).toEqual([]);
    expect(v('// Pressable is mentioned in a comment')).toEqual([]);
  });
});
