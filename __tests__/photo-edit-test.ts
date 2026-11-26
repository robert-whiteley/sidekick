import {
  editPrompt,
  editReply,
  mightBeEdit,
  needsSegModel,
  parseEditReply,
} from '@/engine/photo-edit-logic';

describe('mightBeEdit (only saves a model pass; the model decides)', () => {
  test.each([
    'make the background white',
    'remove the background',
    'blur the background',
    'turn it the right way up',
    'rotate it left',
    'crop it square',
    'make it black and white',
    'can you brighten this',
    'mirror it',
  ])('%s', (q) => expect(mightBeEdit(q)).toBe(true));
  test.each([
    'what is this?',
    'how many calories is that?',
    'who painted this',
    'what colour is the car?',
  ])('%s', (q) => expect(mightBeEdit(q)).toBe(false));
});

test('prompt offers only the edit tool and says when to say none', () => {
  const p = editPrompt('make the background white', new Date('2026-11-26T10:00:00'));
  expect(p).toContain('edit_photo(op: rotate|flip|crop|grayscale|enhance|background');
  expect(p).toContain('A photo is attached');
  expect(p).toContain('{"tool":"none"}');
  expect(p).not.toContain('message(');
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
