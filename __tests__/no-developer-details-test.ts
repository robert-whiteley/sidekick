// Nothing the app sends or shows names a person: no GitHub account URLs, github.io sites or email
// addresses in src/, and every *USER_AGENT constant names the app only. Silent when fine.
declare const __dirname: string;
const fs = jest.requireActual<{
  readFileSync: (p: string, e: string) => string;
  readdirSync: (
    p: string,
    o: { withFileTypes: true },
  ) => { name: string; isDirectory: () => boolean }[];
}>('fs');
const root = `${__dirname}/..`;

const GITHUB_ACCOUNT = /github\.com\/[A-Za-z0-9-]+/g;
const GITHUB_IO = /[A-Za-z0-9-]+\.github\.io/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
// Third-party model files downloaded from their own projects' release pages (not the developer).
const THIRD_PARTY_DOWNLOAD = /github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/releases\/download\b/;
// The privacy policy and licence notices, generated from docs/ (store-facing; see ADR 0006).
const EXEMPT = ['src/content/legal.ts'];

function files(dir: string): string[] {
  return fs.readdirSync(`${root}/${dir}`, { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return files(p);
    return /\.(ts|tsx|js|json)$/.test(e.name) ? [p] : [];
  });
}

export function personalDetails(text: string): string[] {
  const found: string[] = [];
  for (const line of text.split('\n')) {
    const accounts = (line.match(GITHUB_ACCOUNT) ?? []).length;
    const downloads = (line.match(new RegExp(THIRD_PARTY_DOWNLOAD.source, 'g')) ?? []).length;
    if (accounts > downloads || GITHUB_IO.test(line) || EMAIL.test(line)) found.push(line.trim());
  }
  return found;
}

describe('no developer details in the app', () => {
  it('the patterns catch what they should', () => {
    expect(personalDetails("const UA = 'App (https://github.com/someone/app)';")).toHaveLength(1);
    expect(personalDetails('see https://someone.github.io/site')).toHaveLength(1);
    expect(personalDetails('mail me@example.com')).toHaveLength(1);
    expect(
      personalDetails("url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/x.tar'"),
    ).toHaveLength(0);
    expect(personalDetails("import x from '@/web/lookup';")).toHaveLength(0);
  });

  it('src/ has no GitHub account URLs, github.io sites or email addresses', () => {
    const hits = files('src')
      .filter((p) => !EXEMPT.includes(p))
      .flatMap((p) =>
        personalDetails(fs.readFileSync(`${root}/${p}`, 'utf8')).map((l) => `${p}: ${l}`),
      );
    expect(hits).toEqual([]);
  });

  it('every *USER_AGENT constant names the app only', () => {
    const agents = files('src').flatMap((p) =>
      [
        ...fs
          .readFileSync(`${root}/${p}`, 'utf8')
          .matchAll(/export const (\w*USER_AGENT)\s*=\s*(['"`])(.*?)\2/gs),
      ].map((m) => ({ name: m[1], value: m[3] })),
    );
    expect(agents.length).toBeGreaterThanOrEqual(2);
    for (const a of agents) {
      expect({
        name: a.name,
        bad: /https?:|www\.|\.(com|org|io|net|ai)\b|@/.test(a.value),
      }).toEqual({
        name: a.name,
        bad: false,
      });
    }
  });
});
