/**
 * Light photo edits, pure parts: the edit_photo tool, offered to the model's sorter only while a
 * photo comes with the request (decide.ts), so the model decides whether an edit is meant ("make
 * the background white", "turn it the right way up", "crop it square"); the checks on its call,
 * and the reply. Tested in __tests__/photo-edit-test.ts. The edits themselves are PhotoEdit.kt
 * (Android).
 */
import { EDIT_TOOL, validateCall, type EditOp } from './tools-logic';

export { EDIT_OPS, EDIT_TOOL, type EditOp } from './tools-logic';

export type EditCall = { op: EditOp; args: Record<string, string | number> };

/** The model's edit_photo arguments → a checked edit, or null (not usable: answer normally). */
export function editCall(raw: Record<string, unknown>): EditCall | null {
  const v = validateCall({ tool: 'edit_photo', args: raw }, [EDIT_TOOL]);
  if (!v.ok) return null;
  const { op, ...rest } = v.args as { op: EditOp } & Record<string, string | number>;
  const args: Record<string, string | number> = {};
  for (const [k, x] of Object.entries(rest))
    if (typeof x === 'string' || typeof x === 'number') args[k] = x;
  if (op === 'rotate') {
    const d = Math.round(Number(args.degrees ?? 90) / 90) * 90;
    args.degrees = d === 0 ? 90 : d;
  }
  if (op === 'background') {
    if (!args.mode) args.mode = args.color ? 'color' : 'white';
    if (args.mode === 'color' && /^white$/i.test(String(args.color ?? ''))) args.mode = 'white';
  }
  return { op, args };
}

/** Needs the background model (downloaded on first use). */
export const needsSegModel = (e: EditCall) => e.op === 'background';

/** What Sidekick says under the edited photo. */
export function editReply(e: EditCall): string {
  switch (e.op) {
    case 'rotate': {
      const d = Number(e.args.degrees);
      return d === 180
        ? 'Turned it upside down.'
        : `Turned it a quarter turn ${d < 0 ? 'to the left' : 'to the right'}.`;
    }
    case 'flip':
      return e.args.direction === 'vertical' ? 'Flipped it top to bottom.' : 'Mirrored it.';
    case 'crop':
      return e.args.shape === 'tighter'
        ? 'Cropped in closer.'
        : `Cropped it to ${e.args.shape === 'square' || !e.args.shape ? 'a square' : e.args.shape}.`;
    case 'grayscale':
      return 'Made it black and white.';
    case 'enhance':
      return 'Brightened it and evened out the colours.';
    case 'background':
      switch (e.args.mode) {
        case 'remove':
          return 'Removed the background (saved as a PNG with a see-through background).';
        case 'blur':
          return 'Blurred the background.';
        case 'color':
          return `Made the background ${String(e.args.color ?? 'a plain colour').toLowerCase()}.`;
        default:
          return 'Made the background white.';
      }
  }
}

export const EDIT_FOOTER =
  ' Your original is unchanged. Save the new copy below to keep it (copies go after 2 days).';
export const EDIT_NOT_HERE =
  "Editing photos isn't on iPhone yet. I can still answer questions about the photo.";
