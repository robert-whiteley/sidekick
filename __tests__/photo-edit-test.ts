import { EDIT_TOOL, editCall, editReply, needsSegModel } from '@/engine/photo-edit-logic';
import { NOT_IN_ROUTINES } from '@/engine/tools-logic';

/** The model's {"tool":"edit_photo","args":{…}} → its checked edit. */
const parseEditReply = (json: string) => {
  try {
    const o = JSON.parse(json) as { tool?: string; args?: Record<string, unknown> };
    return o.tool === 'edit_photo' && o.args ? editCall(o.args) : null;
  } catch {
    return null;
  }
};

test('edit_photo is offered to the sorter only with a photo, and never to routines', () => {
  expect(EDIT_TOOL.name).toBe('edit_photo');
  expect(NOT_IN_ROUTINES.has('edit_photo')).toBe(true);
});

test('an edit written as a flag is read as the op; one carrying details is not guessed', () => {
  // Seen on the phone (27 Nov), even after the retry with the reason.
  expect(editCall({ grayscale: true })).toEqual({ op: 'grayscale', args: {} });
  expect(editCall({ enhance: {} })).toEqual({ op: 'enhance', args: {} });
  expect(editCall({ background: { mode: 'blur' } })).toBeNull();
  expect(editCall({ grayscale: true, flip: true })).toBeNull();
});

describe('parseEditReply', () => {
  test('background white', () => {
    const e = parseEditReply('{"tool":"edit_photo","args":{"op":"background","mode":"white"}}');
    expect(e).toEqual({ op: 'background', args: { mode: 'white' } });
    expect(needsSegModel(e!)).toBe(true);
    expect(editReply(e!)).toBe('Made the background white.');
  });
  test('a colour without a mode becomes mode color; white colour is white', () => {
    expect(
      parseEditReply('{"tool":"edit_photo","args":{"op":"background","color":"Blue"}}'),
    ).toEqual({ op: 'background', args: { mode: 'color', color: 'Blue' } });
    expect(
      parseEditReply(
        '{"tool":"edit_photo","args":{"op":"background","mode":"color","color":"white"}}',
      )?.args.mode,
    ).toBe('white');
  });
  test('rotation snaps to quarter turns', () => {
    expect(
      parseEditReply('{"tool":"edit_photo","args":{"op":"rotate","degrees":100}}')?.args,
    ).toEqual({
      degrees: 90,
    });
    expect(parseEditReply('{"tool":"edit_photo","args":{"op":"rotate"}}')?.args.degrees).toBe(90);
    const left = parseEditReply('{"tool":"edit_photo","args":{"op":"rotate","degrees":-90}}')!;
    expect(editReply(left)).toBe('Turned it a quarter turn to the left.');
  });
  test('bad values are dropped, unknown ops and none give null', () => {
    expect(parseEditReply('{"tool":"edit_photo","args":{"op":"crop","shape":"triangle"}}')).toEqual(
      { op: 'crop', args: {} },
    );
    expect(parseEditReply('{"tool":"edit_photo","args":{"op":"sparkle"}}')).toBeNull();
    expect(parseEditReply('{"tool":"none"}')).toBeNull();
    expect(parseEditReply('not json')).toBeNull();
  });
  test('replies', () => {
    expect(editReply({ op: 'crop', args: {} })).toBe('Cropped it to a square.');
    expect(editReply({ op: 'background', args: { mode: 'remove' } })).toContain('PNG');
    expect(editReply({ op: 'grayscale', args: {} })).toBe('Made it black and white.');
  });
});
