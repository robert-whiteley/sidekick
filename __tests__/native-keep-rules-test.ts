import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const android = join(__dirname, '../modules/sidekick-native/android');
const rules = readFileSync(join(android, 'consumer-rules.pro'), 'utf8');
const kotlin = join(android, 'src/main/java/dev/sidekick/engine');
const cpp = join(android, 'src/main/cpp');

describe('release keep rules', () => {
  // R8 renames what nothing in Kotlin calls by name; native code that looks a method up by name
  // then fails (every picture failed with NoSuchMethodError in the release build).
  it('keep every Kotlin type whose methods native code looks up by name', () => {
    const looked = readdirSync(cpp)
      .filter((f) => f.endsWith('.cpp'))
      .flatMap((f) =>
        [...readFileSync(join(cpp, f), 'utf8').matchAll(/GetMethodID\([^,]+,\s*"(\w+)"/g)].map(
          (m) => m[1],
        ),
      );
    expect(looked).toContain('onProgress');
    for (const name of looked) {
      const owners = readdirSync(kotlin)
        .filter((f) => f.endsWith('.kt'))
        .flatMap((f) => {
          const src = readFileSync(join(kotlin, f), 'utf8');
          const outer = f.replace(/\.kt$/, '');
          return [
            ...src.matchAll(new RegExp(`interface (\\w+)\\s*\\{[^}]*fun ${name}\\(`, 'g')),
          ].map((m) => `dev.sidekick.engine.${outer}$${m[1]}`);
        });
      expect(owners.length).toBeGreaterThan(0);
      for (const o of owners) expect(rules).toContain(o);
    }
  });
});
