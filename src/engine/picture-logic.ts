/**
 * Making pictures on the phone, pure parts: the content rule Google Play requires, which phones
 * get it, the replies, and the report draft. The model chooses the make_picture tool itself
 * (tools-logic.ts; always offered, decide.ts, so the reply can say what is missing). Tested in
 * __tests__/picture-test.ts. The drawing is ImageGen.kt (SDXS-512 through stable-diffusion.cpp);
 * the licence and policy reasons are in ADR 0006.
 */

/**
 * Google Play's AI-generated content policy asks apps to prevent "Restricted Content", naming
 * sexual material (and above all any involving children) first (ADR 0006 quotes it). That is all
 * Sidekick blocks, and the model judges it, in any wording or language (no word lists): a short
 * yes/no check of the request and the description before drawing. Other requests are the user's
 * business; the Report button below every picture is how harmful results reach the developer.
 */
export const PICTURE_CHECK_SYSTEM =
  'You check requests to a picture maker for one rule. Reply with one word only: yes or no.';

export function pictureCheckPrompt(question: string, described: string): string {
  return (
    `Request: ${JSON.stringify(question)}\nPicture to draw: ${JSON.stringify(described)}\n\n` +
    'Would this picture show sexual content or nudity, or anyone under 18 in a sexual or ' +
    'suggestive way? Things merely called "sexy" (a car, a dress) are not sexual. ' +
    'Reply yes or no.'
  );
}

/** The check's reply → may it be drawn? Fails closed: only a clear "no" allows it. */
export function pictureCheckAllows(reply: string): boolean {
  const m = /^\W*(yes|no)\b/i.exec(reply.trim());
  return !!m && m[1].toLowerCase() === 'no';
}

export type PictureOffer = { offer: boolean; note?: string; why?: 'iphone' | 'cpu' | 'ram' };

/**
 * Who gets "Make pictures": Android phones whose CPU the library is built for (64-bit ARM with
 * dot product and FP16) with 4 GB+ memory; under 6 GB it is offered with a "slow" note (the
 * 1.1 GB it needs while drawing pushes other apps out). Measured on the Pixel 5 (8 GB): ~40 s.
 */
export function pictureOffer(p: {
  platform: 'android' | 'ios' | string;
  ramMb: number;
  cpuOk: boolean;
}): PictureOffer {
  if (p.platform !== 'android') return { offer: false, note: 'Not on iPhone yet.', why: 'iphone' };
  if (!p.cpuOk) return { offer: false, note: "This phone's processor can't run it.", why: 'cpu' };
  if (p.ramMb > 0 && p.ramMb < 3500)
    return { offer: false, note: 'Needs a phone with 4 GB of memory or more.', why: 'ram' };
  if (p.ramMb > 0 && p.ramMb < 5500)
    return { offer: true, note: 'Slow on this phone: about a minute or more per picture.' };
  return { offer: true };
}

/** The model's description, tidied for the image model (it reads ~75 words; style words help). */
export function picturePrompt(described: string, question: string): string {
  const d = (described || question)
    .replace(
      /^(please\s+)?(can you\s+|could you\s+)?(draw|make|create|generate|paint|sketch)\s+(me\s+)?/i,
      '',
    )
    .replace(/^(a\s+)?(picture|image|drawing|painting|illustration)\s+of\s+/i, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.?!]+$/, '');
  return d.slice(0, 300);
}

export const PICTURE_NOT_HERE =
  "Sorry, I can't make pictures on iPhone yet. Only the Android app can draw them for now.";
export const PICTURE_NO_CPU = "This phone's processor can't make pictures, sorry.";
export const PICTURE_LOW_RAM =
  "Sorry, I can't make pictures on this phone: it needs 4 GB of memory or more.";

/**
 * The reply when this phone can't make pictures at all (pictureOffer says no), else null: the
 * iPhone, an older processor or too little memory. Said plainly instead of a web search.
 */
export function pictureUnavailable(offer: PictureOffer): string | null {
  if (offer.offer) return null;
  if (offer.why === 'ram') return PICTURE_LOW_RAM;
  return offer.why === 'cpu' ? PICTURE_NO_CPU : PICTURE_NOT_HERE;
}
export const PICTURE_GET =
  'Making pictures is an optional download (0.7 GB, on Wi-Fi). Get it under Settings → Assistant → Make pictures.';
export const PICTURE_BLOCKED =
  "I can't make that picture: sexual images aren't allowed (Google Play's rule for apps that make pictures).";
export const PICTURE_STOPPED = 'Stopped. No picture was made.';
export const PICTURE_FAILED = "Sorry, I couldn't make the picture.";

/** What Sidekick says under a new picture. */
export function pictureReply(prompt: string, ms: number): string {
  return (
    `Here's “${prompt}”, made on this phone in ${Math.max(1, Math.round(ms / 1000))} s. ` +
    "It's kept in your chat; Save puts a copy in your phone's gallery."
  );
}

/** The status line while drawing: the image model's stage and steps. */
export function pictureStatus(stage: string, done: number, total: number): string {
  const s = stage.toLowerCase();
  if (s.includes('load')) return 'Loading the picture model…';
  if (s.includes('decod') || s.includes('vae')) return 'Finishing the picture…';
  if (total > 1) return `Drawing… (${Math.min(done, total)}/${total})`;
  return 'Drawing…';
}

export const REPORT_REASONS = [
  'Sexual or nude',
  'Involves a child',
  'Violent or hateful',
  'Looks like a real person',
  'Something else',
] as const;

/**
 * Report a picture: an email draft to the developer that the user reads, can change, and sends
 * themselves (nothing is sent by Sidekick, and the picture isn't attached).
 */
export function reportMailto(
  to: string,
  r: { reason: string; prompt: string; version: string | null },
): string {
  const subject = encodeURIComponent('Report: picture made by Sidekick');
  const body = encodeURIComponent(
    [
      `Reason: ${r.reason}`,
      `What was asked for: ${r.prompt}`,
      '',
      'Anything to add:',
      '',
      '',
      `— Added by Sidekick (edit or delete freely) — Sidekick ${r.version ?? '?'}, picture model SDXS-512`,
    ].join('\n'),
  );
  return `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`;
}
