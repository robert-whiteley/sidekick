// scripts/phone-input.sh refuses input unless the phone is taken and Sidekick is in front.
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
  mkdirSync: (p: string) => void;
  writeFileSync: (p: string, s: string, o?: object) => void;
  readFileSync: (p: string, e: string) => string;
  existsSync: (p: string) => boolean;
}>('fs');
const os = jest.requireActual<{ tmpdir: () => string }>('os');

const root = `${__dirname}/..`;
const tmp = fs.mkdtempSync(`${os.tmpdir()}/phone-`);
const lock = `${tmp}/lock`;
const log = `${tmp}/adb.log`;
// A fake adb: reports the focused window from $FOCUS and logs every input event.
const adb = `${tmp}/adb`;
fs.writeFileSync(
  adb,
  `#!/usr/bin/env bash
case "$*" in
  "shell dumpsys window") echo "  mCurrentFocus=Window{1 u0 $FOCUS}" ;;
  "shell dumpsys battery") printf '  level: %s\\n  temperature: 300\\n' "\${LEVEL:-80}" ;;
  "shell input "*) echo "$*" >>"${log}" ;;
esac
`,
  { mode: 0o755 },
);

function input(
  args: string[],
  focus = 'app.ondevice.sidekick/app.ondevice.sidekick.MainActivity',
  env = {},
) {
  fs.writeFileSync(log, '');
  const r = cp.spawnSync(`${root}/scripts/phone-input.sh`, args, {
    encoding: 'utf8',
    env: { ...process.env, ADB: adb, FOCUS: focus, SIDEKICK_PHONE_LOCK: lock, ...env },
  });
  return { status: r.status, err: r.stderr, sent: fs.readFileSync(log, 'utf8').trim() };
}

describe('phone-input.sh', () => {
  it('refuses when the phone is not taken', () => {
    expect(input(['tap', '500', '900']).status).toBe(3);
  });
  it('sends silently when Sidekick is in front', () => {
    if (!fs.existsSync(lock)) fs.mkdirSync(lock);
    const r = input(['tap', '500', '900']);
    expect(r).toEqual({ status: 0, err: '', sent: 'shell input tap 500 900' });
    expect(input(['text', 'hi there']).sent).toBe('shell input text hi%sthere');
  });
  it('refuses another app, the status bar and power keys', () => {
    const other = input(['tap', '500', '900'], 'com.google.android.gm/.ConversationListActivity', {
      FOCUS_WAIT: '0',
    });
    expect(other.status).toBe(3);
    expect(other.sent).toBe('');
    expect(input(['tap', '500', '20']).status).toBe(3);
    expect(input(['swipe', '500', '10', '500', '900']).status).toBe(3);
    expect(input(['key', 'KEYCODE_POWER']).status).toBe(3);
    expect(input(['key', 'KEYCODE_HOME'], 'com.android.launcher').sent).toBe(
      'shell input keyevent KEYCODE_HOME',
    );
  });
});
