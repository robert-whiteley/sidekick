#!/usr/bin/env python3
"""Claude Code PreToolUse hook: the project's checkable rules, enforced instead of written down.

Silent when a call is fine. Blocks with exit 2 and one line on stderr, or asks the owner
(permissionDecision "ask") for things only the owner may approve. Commands are parsed like a shell
(quotes, heredocs, ;, &&, |, $(...)), so text inside a commit message or a grep pattern never
matches; only real commands do. Tests: __tests__/claude-guard-test.ts.
"""
import json
import os
import re
import shlex
import sys

APP = 'app.ondevice.sidekick'
RULE_FILES = {'CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'AGENT.md', 'GEMINI.md',
              '.cursorrules', '.windsurfrules', 'copilot-instructions.md'}
SEPARATORS = {';', '&', '&&', '|', '||', '|&', '(', ')', '\n', ';;'}
WRAPPERS = {'sudo', 'env', 'command', 'time', 'nohup', 'exec', 'nice', 'xargs'}


class Verdict(Exception):
    def __init__(self, kind, reason):
        super().__init__(reason)
        self.kind, self.reason = kind, reason


def deny(reason):
    raise Verdict('deny', reason)


def ask(reason):
    raise Verdict('ask', reason)


def lock_dir():
    return os.environ.get('SIDEKICK_PHONE_LOCK') or f'/tmp/claude-{os.getuid()}/sidekick-phone.lock'


# ---------- shell parsing ----------

HEREDOC = re.compile(r"<<-?[ \t]*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n(.*?)\n[ \t]*\2[ \t]*(?=\n|$)", re.S)


def segments(cmd):
    """Simple commands (lists of words) in a shell command line."""
    cmd = HEREDOC.sub(lambda m: m.group(0).split('\n', 1)[0], cmd)  # drop heredoc bodies (data)
    lex = shlex.shlex(cmd, posix=True, punctuation_chars='();<>|&\n')
    lex.whitespace = ' \t\r'
    lex.whitespace_split = True
    try:
        tokens = list(lex)
    except ValueError:  # unbalanced quotes: let the shell report it
        return []
    out, cur, skip_next = [], [], False
    for t in tokens:
        if skip_next:  # target of a redirection
            skip_next = False
            continue
        if t in SEPARATORS or (t and set(t) <= set(';&|()\n')):
            if cur:
                out.append(cur)
            cur = []
        elif t and set(t) <= set('<>&'):
            skip_next = True
        else:
            cur.append(t)
    if cur:
        out.append(cur)
    return [strip_prefix(s) for s in out if strip_prefix(s)]


def strip_prefix(words):
    """Drops VAR=value, sudo/env/timeout N and npx/bunx (with their flags) before the program."""
    w = list(words)
    while w:
        if re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', w[0]):
            w.pop(0)
        elif w[0] in WRAPPERS:
            w.pop(0)
            while w and w[0].startswith('-'):
                w.pop(0)
        elif w[0] == 'timeout':
            w.pop(0)
            while w and (w[0].startswith('-') or re.match(r'^\d', w[0])):
                w.pop(0)
        elif os.path.basename(w[0]) in ('npx', 'bunx', 'pnpx'):
            w.pop(0)
            while w and w[0].startswith('-'):
                flag = w.pop(0)
                if flag in ('-p', '--package') and w:
                    w.pop(0)
        else:
            break
    return w


def prog(words):
    p = os.path.basename(words[0])
    return re.sub(r'@[^/]*$', '', p) if not p.startswith('@') else p


def inner_shells(words):
    """`bash -c '...'`: the quoted script is checked too."""
    if prog(words) in ('bash', 'sh', 'zsh', 'dash') and '-c' in words:
        i = words.index('-c')
        if i + 1 < len(words):
            return segments(words[i + 1])
    return []


# ---------- rules for each simple command ----------

def check_eas(w):
    if len(w) < 2:
        return
    sub = w[1]
    if sub in ('build', 'submit'):
        if not any(flag_value(w[2:], ('--profile', '-e'), p) for p in ('development', 'preview')):
            deny("Store builds go through 'gh workflow run release.yml -f track=alpha' (both stores "
                 "from one commit). Phone test builds: local gradle or --profile preview.")
    if sub.startswith('update') and to_production(w[2:]):
        ask('Publishes a quick fix to every user (production channel): needs the owner\'s OK.')


def flag_value(args, flags, value):
    """True when one of flags is given value (`--flag value` or `--flag=value`)."""
    for i, a in enumerate(args):
        name, eq, val = a.partition('=')
        if name in flags and ((eq and val == value) or (not eq and args[i + 1:i + 2] == [value])):
            return True
    return False


def to_production(args):
    return flag_value(args, ('--channel', '--branch', '--destination-channel', '--destination-branch'), 'production')


def check_release_sh(w):
    if '--real' not in w or len(w) < 2:
        return
    sub = w[1]
    if sub == 'ship':
        deny("Store builds go through 'gh workflow run release.yml -f track=alpha' (both stores "
             "from one commit), not scripts/release.sh ship.")
    if sub == 'promote' and flag_value(w[2:], ('--to',), 'production'):
        ask('Promotes a release to production on Google Play: needs the owner\'s OK.')
    if sub == 'update' and not flag_value(w[2:], ('--channel',), 'preview'):
        ask('Publishes a quick fix to every user (production channel): needs the owner\'s OK.')


def check_gh(w):
    if len(w) >= 4 and w[1] == 'workflow' and w[2] == 'run' and re.fullmatch(r'release(\.ya?ml)?', w[3]):
        ask("Store build for Google Play and the App Store: needs the owner's OK.")


def check_package_add(p, w):
    if len(w) < 2:
        return
    sub = w[1]
    pkgs = [a for a in w[2:] if not a.startswith('-')]
    if '-g' in w or '--global' in w:
        return
    if (p == 'npm' and sub in ('install', 'i', 'add', 'in', 'isntall') and pkgs) or \
       (p in ('yarn', 'pnpm', 'bun') and sub == 'add'):
        deny('Add packages with `npx expo install <pkg>` (SDK-compatible versions; dev tools: '
             '`npx expo install <pkg> -- --save-dev`).')


def check_git(w):
    args = w[1:]
    sub_i = 0
    while sub_i < len(args) and args[sub_i].startswith('-'):
        if args[sub_i] == '-c' and sub_i + 1 < len(args):
            if re.match(r'core\.hookspath=', args[sub_i + 1], re.I):
                deny('The commit hook must run (no core.hooksPath override).')
            sub_i += 2
        elif args[sub_i] in ('-C', '--git-dir', '--work-tree'):
            sub_i += 2
        else:
            sub_i += 1
    if sub_i >= len(args):
        return
    sub, rest = args[sub_i], args[sub_i + 1:]
    if sub == 'commit':
        takes_value = {'-m', '--message', '-F', '--file', '-C', '-c', '--author', '--date', '-t',
                       '--template', '--fixup', '--squash', '--trailer', '--cleanup'}
        i = 0
        while i < len(rest):
            a = rest[i]
            if a == '--no-verify' or (re.fullmatch(r'-[a-zA-Z]+', a) and 'n' in a[1:]
                                      and not a.startswith(('-m', '-F', '-C', '-c', '-t'))):
                deny('The commit hook must run (no --no-verify); fix what it reports.')
            if a == '--':
                break
            i += 2 if a in takes_value else 1


def check_rm(w, cwd, roots):
    targets = [a for a in w[1:] if not a.startswith('-')]
    for t in targets:
        if any(c in t for c in '$`'):
            continue  # variables: can't tell statically
        path = os.path.realpath(os.path.join(cwd, os.path.expanduser(t)))
        if not any(path == r or path.startswith(r.rstrip('/') + '/') for r in roots):
            ask(f'Deletes {t} outside the project: only with the owner\'s OK (report the space instead).')


ADB_OK = {'devices', 'connect', 'disconnect', 'mdns', 'version', 'kill-server', 'start-server',
          'pair', 'get-state', 'get-serialno', 'wait-for-device', 'reconnect', 'help', 'forward', 'reverse'}
ADB_GLOBAL_WITH_VALUE = {'-s', '-t', '-H', '-P', '-L'}


def is_adb(word):
    return bool(re.fullmatch(r'adb(\.exe)?', os.path.basename(word))) or \
        bool(re.fullmatch(r'\$\{?ADB\}?', word))


def check_adb(w):
    args = w[1:]
    i = 0
    while i < len(args) and args[i].startswith('-'):
        i += 2 if args[i] in ADB_GLOBAL_WITH_VALUE else 1
    if i >= len(args):
        return
    sub, rest = args[i], args[i + 1:]
    if sub in ADB_OK:
        return
    if sub == 'uninstall':
        deny('Never uninstall Sidekick from the test phone (it holds models and test state).')
    if sub in ('reboot', 'root', 'unroot', 'remount', 'disable-verity', 'sideload'):
        deny(f'adb {sub} would lock the phone behind the owner\'s PIN or change the system.')
    if not os.path.isdir(lock_dir()):
        deny('Take the phone first: scripts/phone-lock.sh take <your-name> (one agent at a time).')
    if sub in ('shell', 'exec-out'):
        script = ' '.join(rest)
        for s in segments(script) or ([rest] if rest else []):
            check_phone_shell(s)


PERSONAL_URIS = re.compile(r'content://(sms|mms|mms-sms|contacts|com\.android\.contacts|call_log|'
                           r'media|com\.android\.calendar|calendar|telephony|gmail)', re.I)


def check_phone_shell(w):
    p = os.path.basename(w[0])
    args = w[1:]
    text = ' '.join(args)
    if p == 'input':
        deny('Phone input goes through scripts/phone-input.sh (checks Sidekick is in front first).')
    if p == 'pm' and args and args[0] in ('clear', 'uninstall', 'disable', 'disable-user', 'hide', 'suspend'):
        deny('Never clear, uninstall or disable apps on the test phone.')
    if p == 'svc' and re.search(r'(wifi|data|bluetooth)\s+disable', text):
        deny('Never turn Wi-Fi/data off (kills adb). Offline tests: block only Sidekick '
             '(cmd connectivity set-package-networking-enabled false ' + APP + ').')
    if p == 'cmd':
        if re.search(r'^wifi\s+set-wifi-enabled\s+disabled|^connectivity\s+airplane-mode\s+enable', text):
            deny('Never turn Wi-Fi off or airplane mode on (kills adb). Block only Sidekick instead.')
        if re.search(r'^connectivity\s+set-package-networking-enabled\s+\w+\s+(\S+)', text):
            pkg = re.search(r'set-package-networking-enabled\s+\w+\s+(\S+)', text).group(1)
            if pkg != APP:
                deny('Only Sidekick\'s own networking may be switched off.')
        if re.match(r'^(notification|statusbar)\b', text):
            deny('Leave notifications, Do Not Disturb and the status bar alone.')
    if p == 'settings' and args[:1] == ['put']:
        if re.search(r'airplane_mode_on|wifi_on|zen_mode|mobile_data|bluetooth_on', text):
            deny('Leave airplane mode, Wi-Fi, data and Do Not Disturb as they are.')
    if p == 'content' or PERSONAL_URIS.search(text):
        deny('Never read personal data on the phone (messages, contacts, photos, calendars).')
    if p == 'am' and args and args[0] in ('start', 'start-activity', 'startservice', 'start-foreground-service', 'broadcast'):
        if re.search(r'android\.intent\.action\.(SEND|SENDTO|SEND_MULTIPLE|CALL|DIAL|VIEW)\b', text) \
                and APP not in text and not re.search(r'(^|\s)-d\s+[\'"]?sidekick:', text):
            deny('Never send, draft, call or open things outside Sidekick from adb.')
        comps = re.findall(r'(?:^|\s)-n\s+(\S+)', text) + re.findall(r'(?:^|\s)-p\s+(\S+)', text)
        for c in comps:
            if not c.startswith(APP):
                deny('Only Sidekick may be started on the test phone.')
    if p == 'monkey':
        m = re.search(r'-p\s+(\S+)', text)
        if not m or m.group(1) != APP:
            deny('monkey only with -p ' + APP + '.')
    if p == 'rm':
        for t in [a for a in args if not a.startswith('-')]:
            if not (t.startswith('/data/local/tmp/') or re.search(r'(^|/)(sk[_-]|sidekick)', t, re.I)):
                ask(f'Deletes {t} on the phone: only test files Sidekick agents made (sk_*, '
                    f'/data/local/tmp). Owner\'s OK needed.')


def check_command(cmd, cwd, roots):
    check_written(redirect_targets(cmd), cwd, cmd)
    todo = segments(cmd)
    while todo:
        w = todo.pop(0)
        todo.extend(inner_shells(w))
        if prog(w) in ('bash', 'sh', 'zsh', 'dash') and '-c' in w and w.index('-c') + 1 < len(w):
            check_written(redirect_targets(w[w.index('-c') + 1]), cwd, cmd)
        check_written(write_targets(cmd, w), cwd, cmd)
        p = prog(w)
        if p in ('bash', 'sh', 'zsh', 'dash', 'source', '.') and len(w) > 1 and not w[1].startswith('-'):
            todo.append(w[1:])  # bash scripts/release.sh ...
            continue
        if p in ('eas', 'eas-cli'):
            check_eas(w)
        elif p == 'release.sh' or w[0].endswith('scripts/release.sh'):
            check_release_sh(w)
        elif p == 'gh':
            check_gh(w)
        elif p in ('npm', 'yarn', 'pnpm', 'bun'):
            check_package_add(p, w)
        elif p == 'git':
            check_git(w)
        elif p == 'rm':
            check_rm(w, cwd, roots)
        elif is_adb(w[0]):
            check_adb(w)


# ---------- file edits ----------

def project_root_of(path):
    """The app's root (the folder with app.json) above path, if any."""
    d = os.path.dirname(path)
    while d and d != '/':
        if os.path.isfile(os.path.join(d, 'app.json')) and os.path.isfile(os.path.join(d, 'package.json')):
            return d
        d = os.path.dirname(d)
    return None


NOTE_FIX = 'make it a check script, a test or a hook that runs silently instead'
REASON = re.compile(r'not a script because:[ \t]*\S.{8,}', re.I)


def claude_home():
    return os.path.realpath(os.path.expanduser(os.environ.get('CLAUDE_CONFIG_DIR') or '~/.claude'))


def check_instruction_file(path, text=''):
    """Notes Claude would load in later sessions. In the repo: never. Claude's own memory and
    instruction files: only with a line saying why it can't be a script (Claude checks itself)."""
    path = os.path.realpath(path)
    home = claude_home()
    if path.startswith(home + '/'):
        rel = os.path.relpath(path, home)
        notes = re.match(r'^projects/[^/]+/memory/', rel) or rel in RULE_FILES or rel.startswith('rules/')
        if notes and not REASON.search(text or ''):
            deny(f"A note for later sessions ({rel}): first check whether it can be a silent script, "
                 f"test or hook, and if so {NOTE_FIX}. If it truly can't, put a line "
                 "'Not a script because: <reason>' in what you write.")
        return
    if not project_root_of(path):
        return  # outside the app (e.g. the owner's own files)
    if os.path.basename(path) in RULE_FILES or re.search(r'(^|/)\.(claude|cursor)/(rules|memory)/', path):
        deny(f'No auto-loaded rule files here: {NOTE_FIX}.')


def write_targets(cmd, w):
    """Files a simple command writes: tee, cp, mv, install, ln, touch (redirections are found separately)."""
    p = prog(w)
    args = [a for a in w[1:] if not a.startswith('-')]
    if p in ('tee', 'touch'):
        return args
    if p in ('cp', 'mv', 'install', 'ln') and len(args) >= 2:
        return [args[-1]]
    return []


def redirect_targets(cmd):
    cmd = HEREDOC.sub(lambda m: m.group(0).split('\n', 1)[0], cmd)
    try:
        lex = shlex.shlex(cmd, posix=False, punctuation_chars='();<>|&\n')
        lex.whitespace = ' \t\r'
        lex.whitespace_split = True
        toks = list(lex)
    except ValueError:
        return []
    out = []
    for i, t in enumerate(toks[:-1]):
        if t in ('>', '>>', '>|', '&>', '&>>') or re.fullmatch(r'\d?>>?', t):
            nxt = toks[i + 1].strip('\'"')
            if not re.match(r'^&?\d$', nxt) and nxt != '/dev/null':
                out.append(nxt)
    return out


def check_written(targets, cwd, text=''):
    for t in targets:
        if any(c in t for c in '$`'):
            continue  # variables: can't tell statically
        check_instruction_file(os.path.join(cwd, os.path.expanduser(t)), text)


def check_edit(path, text=''):
    if not path:
        return
    check_instruction_file(path, text)
    root = project_root_of(path)
    if not root:
        return
    rel = os.path.relpath(path, root)
    if rel.split(os.sep)[0] in ('ios', 'android'):
        deny(f'{rel.split(os.sep)[0]}/ is generated (prebuild): change app.json or a config '
                 'plugin in plugins/ instead.')


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return 0
    tool = data.get('tool_name', '')
    inp = data.get('tool_input') or {}
    cwd = data.get('cwd') or os.getcwd()
    try:
        if tool == 'Bash':
            proj = os.environ.get('CLAUDE_PROJECT_DIR') or cwd
            roots = [os.path.realpath(r) for r in (proj, cwd, '/tmp', os.environ.get('TMPDIR', '/tmp'))]
            top = os.popen(f'git -C {shlex.quote(cwd)} rev-parse --show-toplevel 2>/dev/null').read().strip()
            if top:
                roots.append(os.path.realpath(top))
            check_command(inp.get('command', ''), cwd, roots)
        elif tool in ('Write', 'Edit', 'MultiEdit', 'NotebookEdit'):
            text = inp.get('content') or inp.get('new_string') or inp.get('new_source') or ''
            text += ''.join(e.get('new_string', '') for e in inp.get('edits') or [] if isinstance(e, dict))
            check_edit(inp.get('file_path') or inp.get('notebook_path') or '', text)
    except Verdict as v:
        if v.kind == 'deny':
            print('Blocked: ' + v.reason, file=sys.stderr)
            return 2
        print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PreToolUse', 'permissionDecision': 'ask',
                                                 'permissionDecisionReason': v.reason}}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
