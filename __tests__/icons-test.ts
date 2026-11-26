import { readFileSync } from 'fs';
import { join } from 'path';

import { ICONS } from '@/ui/Icon';

test('every icon uses the Material Symbols code point expo-symbols draws on Android', () => {
  const symbols = JSON.parse(
    readFileSync(
      join(__dirname, '..', 'node_modules', 'expo-symbols', 'build', 'android', 'symbols.json'),
      'utf8',
    ),
  ) as Record<string, number>;
  for (const icon of Object.values(ICONS))
    expect([icon.name, icon.code]).toEqual([icon.name, symbols[icon.name]]);
});
