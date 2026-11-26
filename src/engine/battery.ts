import * as Battery from 'expo-battery';
import { type BatterySample, DRAIN_WINDOW_MS, drainingOnCharger } from '@/memory/embed-policy';

export type BatteryInfo = { charging: boolean; batteryLevel: number; lowPowerMode: boolean };

/** Charging state, level (0..1, or -1 if unknown) and low-power mode; safe defaults on error. */
export async function batteryState(): Promise<BatteryInfo> {
  try {
    const [state, level, low] = await Promise.all([
      Battery.getBatteryStateAsync(),
      Battery.getBatteryLevelAsync(),
      Battery.isLowPowerModeEnabledAsync(),
    ]);
    const charging = state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL;
    remember({ at: Date.now(), level, charging });
    return { charging, batteryLevel: level, lowPowerMode: low };
  } catch {
    return { charging: false, batteryLevel: -1, lowPowerMode: false };
  }
}

const samples: BatterySample[] = [];
function remember(x: BatterySample) {
  // Unplugging starts a new record: only readings on the charger count.
  if (!x.charging) samples.length = 0;
  else samples.push(x);
  while (samples.length && x.at - samples[0].at > DRAIN_WINDOW_MS) samples.shift();
}

/** On a charger but the battery fell over the last few minutes (see drainingOnCharger). */
export const chargerFallingBehind = () => drainingOnCharger(samples, Date.now());
