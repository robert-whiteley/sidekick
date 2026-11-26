import type { DeviceProfile } from '@/engine/device-profile';
import type { Integration } from '@/integrations/registry';

/**
 * Whether an integration can run on this phone, and why not. `only` lists the switches that
 * work here when just some do (Phone info on iPhone: battery, storage and steps).
 */
export function integrationAvailability(
  i: Pick<Integration, 'androidOnly'> & Partial<Pick<Integration, 'switches'>>,
  p: Pick<DeviceProfile, 'platform'>,
): { available: boolean; why?: string; only?: string[] } {
  const some = (i.switches ?? []).filter((s) => s.iphone).map((s) => s.id);
  if (i.androidOnly && p.platform === 'ios' && some.length) {
    return { available: true, only: some };
  }
  if (i.androidOnly && p.platform !== 'android') {
    return {
      available: false,
      why: p.platform === 'ios' ? 'Not possible on iPhone: Apple doesn’t allow it' : 'Android only',
    };
  }
  return { available: true };
}
