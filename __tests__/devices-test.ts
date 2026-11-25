import {
  audioChoices,
  cameraChoices,
  iosAudio,
  micNotice,
  NOT_ON_IPHONE,
  usbCameraNotice,
} from '../src/engine/devices-logic';
import type { AudioDevices } from '../modules/sidekick-native';

const snap: AudioDevices = {
  inputs: [
    { id: 1, key: 'phone:Phone mic', kind: 'phone', name: 'Phone mic' },
    { id: 3, key: 'usb:Arducam', kind: 'usb', name: 'Arducam' },
  ],
  outputs: [
    { id: 5, key: 'phone:Phone speaker', kind: 'phone', name: 'Phone speaker' },
    { id: 6, key: 'bluetooth:Pixel Buds', kind: 'bluetooth', name: 'Pixel Buds' },
  ],
  input: 'usb:Arducam',
  output: 'bluetooth:Pixel Buds',
  recommendedInput: 'usb:Arducam',
  recommendedOutput: 'bluetooth:Pixel Buds',
};

describe('devices', () => {
  it('recommends a plugged-in USB camera over the phone camera', () => {
    const c = cameraChoices('android', [{ name: 'Arducam IMX708', permission: false }], false);
    expect(c.map((x) => [x.name, x.recommended, x.active])).toEqual([
      ['Arducam IMX708', true, false],
      ['Phone camera', false, true],
    ]);
    expect(c[0].why).toMatch(/OK/);
    expect(cameraChoices('android', [], false)[0]).toMatchObject({
      name: 'Phone camera',
      recommended: true,
    });
  });

  it('lists the USB camera on iPhone as not possible', () => {
    const c = cameraChoices('ios', [], false);
    expect(c[1]).toMatchObject({ kind: 'usb', available: false, why: NOT_ON_IPHONE });
    expect(iosAudio().inputs).toHaveLength(1);
  });

  it('marks the active and recommended mic and speaker', () => {
    expect(audioChoices(snap, true).find((m) => m.active)?.name).toBe('Arducam');
    expect(audioChoices(snap, false).find((m) => m.recommended)?.name).toBe('Pixel Buds');
  });

  it('says when the USB camera is unplugged only if it was in use', () => {
    const off = { kind: 'usbCamera' as const, attached: false, name: 'Arducam', permission: null };
    expect(usbCameraNotice(off, true)?.text).toBe('Camera unplugged: switched to the phone camera');
    expect(usbCameraNotice(off, false)).toBeNull();
    expect(usbCameraNotice({ ...off, attached: true, permission: true }, false)?.text).toMatch(
      /Arducam/,
    );
    expect(usbCameraNotice({ ...off, attached: true, permission: null }, false)).toBeNull();
  });

  it('says when the mic in use was unplugged', () => {
    const after = { ...snap, inputs: [snap.inputs[0]], input: 'phone:Phone mic' };
    expect(micNotice('usb:Arducam', after)?.text).toBe('Mic disconnected: using the phone mic');
    expect(micNotice('usb:Arducam', snap)).toBeNull();
    expect(micNotice(null, after)).toBeNull();
  });
});
