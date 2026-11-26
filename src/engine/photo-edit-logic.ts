/**
 * Light photo edits, pure parts: the one-tool catalog the model picks from when a photo comes
 * with a request ("make the background white", "turn it the right way up", "crop it square"),
 * the checks on its pick, and the reply. The model decides whether an edit is meant at all; the
 * word list only saves a model pass on plain photo questions ("what is this?"). Tested in
 * __tests__/photo-edit-test.ts. The edits themselves are PhotoEdit.kt (Android).
 */
import { routerPrompt, type ToolSpec, validateCall, parseToolReply } from './tools-logic';

export const EDIT_OPS = ['rotate', 'flip', 'crop', 'grayscale', 'enhance', 'background'] as const;
export type EditOp = (typeof EDIT_OPS)[number];

export const EDIT_TOOL: ToolSpec = {
  name: 'edit_photo',
  desc:
    'change the photo: rotate (degrees 90 = clockwise, -90, 180), flip (mirror), crop to a ' +
    'shape, grayscale (black and white), enhance (brighter, clearer colours), background ' +
    '(remove, white, a colour, or blur)',
  kind: 'action',
  args: {
    op: { type: 'string', values: [...EDIT_OPS], required: true },
    degrees: { type: 'number', min: -270, max: 270 },
    direction: { type: 'string', values: ['horizontal', 'vertical'] },
    shape: { type: 'string', values: ['square', '4:3', '3:4', '16:9', '9:16', 'tighter'] },
    mode: { type: 'string', values: ['remove', 'white', 'color', 'blur'] },
    color: { type: 'string', desc: 'colour name, for mode color' },
  },
  words:
    /\b(rotate|turn|upside|sideways|right way|flip|mirror|crop|square|background|backdrop|blur|blurry|transparent|cut ?out|enhance|brighten|brighter|sharpen|improve|black and white|b ?& ?w|gr[ae]yscale|monochrome|edit)\b/i,
};

/** Worth asking the model whether [q] (sent with a photo) is an edit. */
export function mightBeEdit(q: string): boolean {
  return EDIT_TOOL.words.test(q);
}

export function editPrompt(q: string, now: Date): string {
  return routerPrompt(q, now, [EDIT_TOOL]).replace(
    'Request:',
    'A photo is attached. If the request asks to change the photo itself, pick the edit; if it ' +
      'asks a question about the photo, reply {"tool":"none"}.\nRequest:',
  );
}

export type EditCall = { op: EditOp; args: Record<string, string | number> };

/** The model's reply → a checked edit, or null (no edit, or not usable: answer normally). */
export function parseEditReply(reply: string): EditCall | null {
  const call = parseToolReply(reply);
  if (!call || call.tool !== 'edit_photo') return null;
  const v = validateCall(call, [EDIT_TOOL]);
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
