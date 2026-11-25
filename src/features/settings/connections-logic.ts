import type { DeviceProfile } from '@/engine/device-profile';
import type { Integration } from '@/integrations/registry';

/** Whether an integration can run on this phone and build, and why not. */
export function integrationAvailability(
  i: Pick<Integration, 'androidOnly' | 'flavour'>,
  p: Pick<DeviceProfile, 'platform' | 'flavour'>,
): { available: boolean; why?: string } {
  if (i.androidOnly && p.platform !== 'android') {
    return {
      available: false,
      why: p.platform === 'ios' ? 'Not possible on iPhone: Apple doesn’t allow it' : 'Android only',
    };
  }
  if (i.flavour === 'full' && p.flavour !== 'full') {
    return {
      available: false,
      why: 'Not in the Google Play version (Google doesn’t allow it); in the direct-download version',
    };
  }
  return { available: true };
}
