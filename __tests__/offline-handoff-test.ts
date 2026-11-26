import { offlineSearchLine, searchHandOff } from '@/integrations/extras-logic';

const has = (pkgs: string[]) => (p: string) => pkgs.includes(p);

describe('search hand-offs and Offline', () => {
  it('opens an installed app the user named, online or offline', () => {
    expect(searchHandOff('youtube', has(['com.google.android.youtube']), false)).toBe('app');
    expect(searchHandOff('maps', has(['com.google.android.apps.maps']), true)).toBe('app');
  });
  it('never opens the browser by itself while Offline (pancake case)', () => {
    expect(searchHandOff('web', has([]), false)).toBe('tap');
    expect(searchHandOff('google', has([]), false)).toBe('tap');
    // A named app that isn't installed would fall back to the browser: also waits for a tap.
    expect(searchHandOff('amazon', has([]), false)).toBe('tap');
  });
  it('opens the browser when Online', () => {
    expect(searchHandOff('web', has([]), true)).toBe('browser');
    expect(searchHandOff('amazon', has([]), true)).toBe('browser');
  });
  it('says why nothing opened', () => {
    expect(offlineSearchLine('web', 'pancake recipes')).toMatch(
      /offline.*search the web for pancake recipes/i,
    );
    expect(offlineSearchLine('amazon', 'socks')).toMatch(/Amazon for socks/);
  });
});
