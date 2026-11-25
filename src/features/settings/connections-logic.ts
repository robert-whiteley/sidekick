import type { DeviceProfile } from '@/engine/device-profile';
import type { Integration } from '@/integrations/registry';

/** Whether an integration can run on this phone, and why not. */
export function integrationAvailability(
  i: Pick<Integration, 'androidOnly'>,
  p: Pick<DeviceProfile, 'platform'>,
): { available: boolean; why?: string } {
  if (i.androidOnly && p.platform !== 'android') {
    return {
      available: false,
      why: p.platform === 'ios' ? 'Not possible on iPhone: Apple doesn’t allow it' : 'Android only',
    };
  }
  return { available: true };
}
