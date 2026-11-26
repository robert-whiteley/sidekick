import { readFileSync } from 'fs';
import { join } from 'path';

import { IOS_FALLBACKS, withIosFallbacks } from '../modules/sidekick-native/src/ios-fallbacks';
import { freshOrNull, keepFix } from '../modules/sidekick-native/src/ios-location';

jest.mock('expo-location', () => ({}), { virtual: true });

const root = join(__dirname, '..', 'modules', 'sidekick-native');

/** Method names declared in the TS module, split into required and optional. */
function declared(): { required: string[]; optional: string[] } {
  const src = readFileSync(join(root, 'src', 'SidekickNativeModule.ts'), 'utf8');
  const body = src.slice(src.indexOf('declare class'), src.indexOf('\n}\n'));
  const required: string[] = [];
  const optional: string[] = [];
  for (const m of body.matchAll(/^ {2}(\w+)(\?)?\(/gm)) {
    (m[2] ? optional : required).push(m[1]);
  }
  return { required, optional };
}

function swiftFunctions(): string[] {
  const src = readFileSync(join(root, 'ios', 'SidekickNativeModule.swift'), 'utf8');
  return [...src.matchAll(/(?:Async)?Function\("(\w+)"\)/g)].map((m) => m[1]);
}

describe('iPhone native module coverage', () => {
  const { required, optional } = declared();
  const swift = swiftFunctions();

  it('finds the declarations', () => {
    expect(required.length).toBeGreaterThan(60);
    expect(swift).toContain('llmGenerate');
  });

  it('answers every required call on iPhone (Swift or a fallback)', () => {
    const missing = required.filter((m) => !swift.includes(m) && !(m in IOS_FALLBACKS));
    expect(missing).toEqual([]);
  });

  it('has no fallback for something Swift already does', () => {
    expect(Object.keys(IOS_FALLBACKS).filter((k) => swift.includes(k))).toEqual([]);
  });

  it('only falls back for declared calls', () => {
    const all = [...required, ...optional];
    expect(Object.keys(IOS_FALLBACKS).filter((k) => !all.includes(k))).toEqual([]);
  });

  it('declares every Swift function', () => {
    const all = [...required, ...optional];
    expect(swift.filter((k) => !all.includes(k))).toEqual([]);
  });
});

describe('withIosFallbacks', () => {
  it('prefers native calls, binds them, and fills the rest', () => {
    const native = {
      name: 'x',
      who(this: { name: string }) {
        return this.name;
      },
    };
    const m = withIosFallbacks(native) as unknown as Record<string, (...a: unknown[]) => unknown>;
    const who = m.who;
    expect(who()).toBe('x');
    expect(m.listenWanted()).toBe(false);
    expect(m.cameraStart()).toBe(false);
    expect((m.cameraStatus() as { running: boolean }).running).toBe(false);
    expect(m.journalDrain()).toEqual([]);
    expect(m.wipeAllData).toBeUndefined();
  });
});

describe('iPhone location cache', () => {
  const a = { lat: 1, lon: 2, accuracyM: 10, at: 1000 };
  const b = { lat: 3, lon: 4, accuracyM: 10, at: 2000 };

  it('keeps the newest fix', () => {
    expect(keepFix(null, a)).toBe(a);
    expect(keepFix(a, b)).toBe(b);
    expect(keepFix(b, a)).toBe(b);
    expect(keepFix(a, null)).toBe(a);
  });

  it('drops fixes older than 2 hours', () => {
    expect(freshOrNull(a, 1000 + 3_600_000)).toBe(a);
    expect(freshOrNull(a, 1000 + 2 * 3_600_000 + 1)).toBeNull();
    expect(freshOrNull(null, 0)).toBeNull();
  });
});
