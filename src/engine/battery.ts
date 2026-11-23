import * as Battery from 'expo-battery';

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
    return { charging, batteryLevel: level, lowPowerMode: low };
  } catch {
    return { charging: false, batteryLevel: -1, lowPowerMode: false };
  }
}
