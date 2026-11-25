import { useEffect, useState } from 'react';

import { recommended, type Recommended } from '@/engine/device-profile';
import { getSettings, onSettingsChange, type Settings, updateSettings } from '@/engine/settings';

/** Live settings plus this phone's Recommended values; `set` saves a change. */
export function useSettings(): {
  s: Settings;
  rec: Recommended;
  set: (patch: Partial<Settings>) => void;
} {
  const [s, setS] = useState<Settings>(getSettings());
  useEffect(() => onSettingsChange(setS), []);
  return { s, rec: recommended(s), set: (patch) => updateSettings(patch) };
}
