/**
 * Making pictures on the phone, pure parts: the content rule Google Play requires, which phones
 * get it, the replies, and the report draft. The model chooses the make_picture tool itself
 * (tools-logic.ts; offered once the model is downloaded, decide.ts). Tested in
 * __tests__/picture-test.ts. The drawing is ImageGen.kt (SDXS-512 through stable-diffusion.cpp);
 * the licence and policy reasons are in ADR 0006.
 */

/**
 * Google Play's AI-generated content policy asks apps to prevent "Restricted Content", naming
 * sexual material (and above all any involving children) first (ADR 0006 quotes it). That is all
 * Sidekick blocks: other requests are the user's business, and the Report button below every
 * picture is how harmful results reach the developer.
 */
const SEXUAL =
  /\b(nudes?|naked|nudity|nsfw|porn\w*|sex|sexy|sexual\w*|erotic\w*|hentai|topless|bottomless|lingerie|undress\w*|unclothed|strip(ping|per|tease)|genitals?|penis|vagina|boobs?|nipples?|orgasm\w*|fetish\w*|bdsm|xxx|lewd)\b/i;

/** Why a picture can't be made ([texts]: the request and the model's description), or null. */
export function pictureBlocked(...texts: string[]): 'sexual' | null {
  return texts.some((t) => SEXUAL.test(t)) ? 'sexual' : null;
}

export type PictureOffer = { offer: boolean; note?: string };

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
  if (p.platform !== 'android') return { offer: false, note: 'Not on iPhone yet.' };
  if (!p.cpuOk) return { offer: false, note: "This phone's processor can't run it." };
  if (p.ramMb > 0 && p.ramMb < 3500)
    return { offer: false, note: 'Needs a phone with 4 GB of memory or more.' };
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

export const PICTURE_NOT_HERE = "Making pictures isn't on iPhone yet.";
export const PICTURE_NO_CPU = "This phone's processor can't make pictures, sorry.";
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
