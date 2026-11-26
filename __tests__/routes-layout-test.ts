// Expo Router: every file in src/app is a screen (or _layout) with a default export; components,
// hooks and helpers live outside src/app.
declare const __dirname: string;
const fs = jest.requireActual<{
  readFileSync: (p: string, e: string) => string;
  readdirSync: (
    p: string,
    o: { withFileTypes: true },
  ) => { name: string; isDirectory: () => boolean }[];
}>('fs');
const root = `${__dirname}/..`;

function files(dir: string): string[] {
  return fs
    .readdirSync(`${root}/${dir}`, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
}

describe('src/app holds only routes', () => {
  it('each file is a .tsx screen with a default export', () => {
    const bad = files('src/app').filter(
      (p) => !p.endsWith('.tsx') || !/export default/.test(fs.readFileSync(`${root}/${p}`, 'utf8')),
    );
    expect(bad).toEqual([]);
  });
});
