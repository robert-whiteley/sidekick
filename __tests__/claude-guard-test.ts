// The Claude Code hook (scripts/claude-guard.py) blocks only real commands, never text in messages.
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
}>('fs');
const os = jest.requireActual<{ tmpdir: () => string }>('os');

const root = `${__dirname}/..`;
const tmp = fs.mkdtempSync(`${os.tmpdir()}/guard-`);
const lockHeld = `${tmp}/held.lock`;
fs.mkdirSync(lockHeld);
const lockFree = `${tmp}/free.lock`;

type Result = 'ok' | 'deny' | 'ask';
const claudeHome = `${tmp}/claude-home`;
function run(input: object, lock = lockHeld, configDir = claudeHome): Result {
  const r = cp.spawnSync('python3', [`${root}/scripts/claude-guard.py`], {
    input: JSON.stringify({ cwd: root, ...input }),
    encoding: 'utf8',
    env: {
      ...process.env,
      SIDEKICK_PHONE_LOCK: lock,
      CLAUDE_PROJECT_DIR: root,
      CLAUDE_CONFIG_DIR: configDir,
    },
  });
  if (r.status === 2) return 'deny';
  if (r.status !== 0) throw new Error(r.stderr);
  if (r.stdout.includes('"ask"')) return 'ask';
  expect(r.stdout + r.stderr).toBe(''); // silent when fine
  return 'ok';
}
const bash = (command: string, lock?: string) =>
  run({ tool_name: 'Bash', tool_input: { command } }, lock);

const table: [string, Result][] = [
  // store builds and publishing
  ['npx eas-cli build -p android --profile production', 'deny'],
  ['eas build --platform all', 'deny'],
  ['npx -y eas-cli@latest submit -p ios --latest', 'deny'],
  ['cd x && eas build -p android --profile preview', 'ok'],
  ['eas build -p android -e development', 'ok'],
  ['git commit -m "Block eas build -p android in hooks"', 'ok'],
  ["grep -n 'eas build' docs/RELEASE.md", 'ok'],
  ["git commit -F - <<'EOF'\nStore builds\neas build -p ios\nEOF", 'ok'],
  ['echo $(eas build -p ios)', 'deny'],
  ["bash -c 'eas submit -p android'", 'deny'],
  ['gh workflow run release.yml -f track=alpha', 'ask'],
  ['gh workflow run ci.yml', 'ok'],
  ['gh pr create --body "run gh workflow run release.yml later"', 'ok'],
  ['gh api -X POST repos/o/r/actions/workflows/release.yml/dispatches -f ref=main', 'ask'],
  ['gh api repos/o/r/actions/workflows/release.yml/runs', 'ok'],
  ['gh workflow run android-emu.yml', 'ok'],
  ['scripts/release.sh ship --real', 'deny'],
  ['scripts/release.sh ship', 'ok'],
  ['bash scripts/release.sh ship --real', 'deny'],
  ['scripts/release.sh promote --from alpha --to production --rollout 0.2 --real', 'ask'],
  ['scripts/release.sh promote --from internal --to alpha --real', 'ok'],
  ['scripts/release.sh update --notes n.txt --real', 'ask'],
  ['scripts/release.sh update --notes n.txt --channel preview --real', 'ok'],
  ['eas update:republish --channel production', 'ask'],
  ['eas update --channel preview --message "not production"', 'ok'],
  // dependencies
  ['npm install expo-camera', 'deny'],
  ['npm i -D left-pad', 'deny'],
  ['yarn add lodash', 'deny'],
  ['npm install', 'ok'],
  ['npm ci', 'ok'],
  ['npm install -g eas-cli', 'ok'],
  ['npx expo install expo-camera', 'ok'],
  ['git commit -m "npm install foo is blocked"', 'ok'],
  // commit hook
  ['git commit --no-verify -m x', 'deny'],
  ['git commit -nm x', 'deny'],
  ['git -c core.hooksPath=/dev/null commit -m x', 'deny'],
  ['git -c user.email=a@users.noreply.github.com commit -m "skip --no-verify? never"', 'ok'],
  ['git commit -am "fix -n flag"', 'ok'],
  // deleting files
  ['rm -rf node_modules', 'ok'],
  ['rm -rf /tmp/x', 'ok'],
  ['rm -rf ~/Documents/old', 'ask'],
  ['rm /mnt/c/Users/someone/Desktop/a.txt', 'ask'], // privacy-allow (made-up path)
  ['rm -rf "$OUT"', 'ok'],
  ['echo "rm -rf ~/x"', 'ok'],
  // the phone
  ['"$ADB" shell input tap 10 20', 'deny'],
  ['adb.exe -s X shell "input text hello"', 'deny'],
  ['scripts/phone-input.sh tap 10 20', 'ok'],
  ['"$ADB" shell dumpsys window', 'ok'],
  ['"$ADB" install app.apk', 'ok'],
  ['adb uninstall app.ondevice.sidekick', 'deny'],
  ['$ADB shell pm clear app.ondevice.sidekick', 'deny'],
  ['$ADB shell svc wifi disable', 'deny'],
  ['$ADB shell cmd connectivity airplane-mode enable', 'deny'],
  ['$ADB shell cmd connectivity set-package-networking-enabled false app.ondevice.sidekick', 'ok'],
  ['$ADB shell cmd connectivity set-package-networking-enabled false com.android.chrome', 'deny'],
  ['$ADB shell content query --uri content://sms/inbox', 'deny'],
  ['$ADB shell am start -n app.ondevice.sidekick/.MainActivity', 'ok'],
  ['$ADB shell am start -n com.google.android.gm/.ConversationListActivity', 'deny'],
  ['$ADB shell am start -a android.intent.action.SENDTO -d sms:123', 'deny'],
  ['adb shell am start -a android.intent.action.VIEW -d "sidekick://bench?run=answers"', 'ok'],
  ['adb shell am start -a android.intent.action.VIEW -d https://example.com', 'deny'],
  ['$ADB shell settings put global zen_mode 0', 'deny'],
  ['$ADB shell rm -f /sdcard/sk_ui.xml', 'ok'],
  ['$ADB shell rm /sdcard/DCIM/Camera/IMG_1.jpg', 'ask'],
  ['$ADB reboot', 'deny'],
  ['adb devices', 'ok'],
  ['git commit -m "adb shell input tap is wrapped"', 'ok'],
];

describe('claude-guard: Bash', () => {
  it.each(table)('%s → %s', (cmd, want) => expect(bash(cmd)).toBe(want));
  it('needs the phone lock for phone commands', () => {
    expect(bash('"$ADB" shell dumpsys battery', lockFree)).toBe('deny');
    expect(bash('"$ADB" devices', lockFree)).toBe('ok');
  });
});

describe('claude-guard: edits', () => {
  it.each([
    [`${root}/CLAUDE.md`, 'deny'],
    [`${root}/src/AGENTS.md`, 'deny'],
    [`${root}/.claude/rules/x.md`, 'deny'],
    [`${root}/android/app/build.gradle`, 'deny'],
    [`${root}/ios/Podfile`, 'deny'],
    [`${root}/modules/sidekick-native/android/build.gradle`, 'ok'],
    [`${root}/docs/SPEC.md`, 'ok'],
    ['/elsewhere/CLAUDE.md', 'ok'],
    [`${root}/.claude/memory/x.md`, 'deny'],
    [`${claudeHome}/CLAUDE.md`, 'deny'],
    [`${claudeHome}/projects/p/memory/MEMORY.md`, 'deny'],
    [`${claudeHome}/settings.json`, 'ok'],
  ] as [string, Result][])('%s → %s', (p, want) =>
    expect(run({ tool_name: 'Edit', tool_input: { file_path: p } }, lockHeld, claudeHome)).toBe(
      want,
    ),
  );
});

describe('claude-guard: a note for later sessions carries its reason', () => {
  const write = (content: string) =>
    run({ tool_name: 'Write', tool_input: { file_path: `${claudeHome}/CLAUDE.md`, content } });
  it('is blocked without a reason and allowed with one, never asking the owner', () => {
    expect(write('- Answer briefly.')).toBe('deny');
    expect(write('- Answer briefly.\nNot a script because:')).toBe('deny');
    expect(
      write('- Answer briefly.\nNot a script because: a style choice no check can judge'),
    ).toBe('ok');
  });
  it('stays blocked in the repo, reason or not', () => {
    const content = 'Not a script because: a style choice no check can judge';
    expect(
      run({ tool_name: 'Write', tool_input: { file_path: `${root}/CLAUDE.md`, content } }),
    ).toBe('deny');
  });
});

describe('claude-guard: notes written from the shell', () => {
  it.each([
    ['echo rule > CLAUDE.md', 'deny'],
    ['printf x >> src/AGENTS.md', 'deny'],
    ["bash -c 'echo x > CLAUDE.md'", 'deny'],
    ['echo x | tee docs/CLAUDE.md', 'deny'],
    ['cp /tmp/x .claude/rules/a.md', 'deny'],
    ['cat > CLAUDE.md <<EOF\nrule\nEOF', 'deny'],
    [`echo x > ${claudeHome}/projects/p/memory/a.md`, 'deny'],
    [`echo 'Not a script because: it is a taste choice' >> ${claudeHome}/CLAUDE.md`, 'ok'],
    ['echo "> CLAUDE.md" > /dev/null', 'ok'],
    ['git commit -m "no CLAUDE.md > here"', 'ok'],
    ['echo x > docs/SPEC.md', 'ok'],
    ['npx jest 2>&1 | tail', 'ok'],
  ] as [string, Result][])('%s → %s', (command, want) =>
    expect(run({ tool_name: 'Bash', tool_input: { command } }, lockHeld, claudeHome)).toBe(want),
  );
});
