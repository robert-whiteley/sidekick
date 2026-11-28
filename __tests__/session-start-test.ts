// The SessionStart hook (scripts/session-start.sh) works in a fresh cloud container and never
// fails a session: no node, no nvm, a failing npm ci, a copy outside git.
declare const __dirname: string;
const cp = jest.requireActual<{
  spawnSync: (
    c: string,
    a: string[],
    o: object,
  ) => { status: number; stdout: string; stderr: string };
}>('child_process');
const fs = jest.requireActual<{
  mkdtempSync: (p: string) => string;
  mkdirSync: (p: string, o?: object) => void;
  copyFileSync: (a: string, b: string) => void;
  writeFileSync: (p: string, d: string, o?: object) => void;
  readFileSync: (p: string, e: string) => string;
  existsSync: (p: string) => boolean;
  symlinkSync: (target: string, p: string) => void;
}>('fs');
const os = jest.requireActual<{ tmpdir: () => string }>('os');

const script = `${__dirname}/../scripts/session-start.sh`;
// Only the shell tools the script uses go on PATH: no real node or npm can be found.
const TOOLS = [
  'bash',
  'sh',
  'timeout',
  'sha256sum',
  'cut',
  'cat',
  'ls',
  'tail',
  'dirname',
  'mkdir',
  'awk',
];

/** A project copy outside git, with fake node/npm on PATH (npm logs its calls). */
function project(npmExit: number | null) {
  const dir = fs.mkdtempSync(`${os.tmpdir()}/session-`);
  fs.mkdirSync(`${dir}/scripts`);
  fs.mkdirSync(`${dir}/bin`);
  fs.copyFileSync(script, `${dir}/scripts/session-start.sh`);
  fs.writeFileSync(`${dir}/package-lock.json`, '{}');
  for (const t of TOOLS) {
    const real = cp
      .spawnSync('bash', ['-c', `command -v ${t}`], {})
      .stdout.toString()
      .trim();
    if (real) fs.symlinkSync(real, `${dir}/bin/${t}`);
  }
  if (npmExit !== null) {
    fs.writeFileSync(`${dir}/bin/node`, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(
      `${dir}/bin/npm`,
      `#!/bin/sh\necho "$@" >> "${dir}/npm-calls"\nmkdir -p node_modules\nexit ${npmExit}\n`,
      { mode: 0o755 },
    );
  }
  return dir;
}

/** A fake df on PATH reporting this many GB free on the repo's disk. */
function freeGb(dir: string, gb: number) {
  fs.writeFileSync(
    `${dir}/bin/df`,
    `#!/bin/sh\necho 'Filesystem 1024-blocks Used Available Capacity Mounted'\necho "/dev/x 100 1 ${gb * 1048576} 1% /"\n`,
    { mode: 0o755 },
  );
}

function start(dir: string, env: Record<string, string>) {
  return cp.spawnSync('bash', [`${dir}/scripts/session-start.sh`], {
    encoding: 'utf8',
    // No git on PATH either: the copy's git steps fail quietly, as offline or outside a clone.
    env: { PATH: `${dir}/bin`, HOME: `${dir}/home`, ...env },
  });
}

const calls = (dir: string) =>
  fs.existsSync(`${dir}/npm-calls`) ? fs.readFileSync(`${dir}/npm-calls`, 'utf8') : '';

test('no node and no nvm: nothing happens, exit 0', () => {
  const dir = project(null);
  const r = start(dir, { CLAUDE_CODE_REMOTE: 'true' });
  expect(r.status).toBe(0);
  expect(calls(dir)).toBe('');
});

test('on the laptop the packages are left alone', () => {
  const dir = project(0);
  expect(start(dir, {}).status).toBe(0);
  expect(calls(dir)).toBe('');
});

test('in the cloud: npm ci once, again only when the lock file changes', () => {
  const dir = project(0);
  expect(start(dir, { CLAUDE_CODE_REMOTE: 'true' }).status).toBe(0);
  expect(start(dir, { CLAUDE_CODE_REMOTE: 'true' }).status).toBe(0);
  expect(calls(dir).trim().split('\n')).toHaveLength(1);
  expect(calls(dir)).toContain('ci');
  fs.writeFileSync(`${dir}/package-lock.json`, '{"v":2}');
  start(dir, { CLAUDE_CODE_REMOTE: 'true' });
  expect(calls(dir).trim().split('\n')).toHaveLength(2);
});

test('a failing npm ci says so and still exits 0', () => {
  const dir = project(1);
  const r = start(dir, { CLAUDE_CODE_REMOTE: 'true' });
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('npm ci failed');
});

test('a disk under 15 GB free says so in one line; otherwise nothing', () => {
  const low = project(null);
  freeGb(low, 9);
  const r = start(low, {});
  expect(r.status).toBe(0);
  expect(r.stdout.trim()).toBe('Disk low: 9 GB free');
  const ok = project(null);
  freeGb(ok, 40);
  expect(start(ok, {}).stdout).toBe('');
});

test('no df at all: nothing said, exit 0', () => {
  const dir = project(null);
  const r = start(dir, {});
  expect(r.status).toBe(0);
  expect(r.stdout).not.toContain('Disk low');
});
