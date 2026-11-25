/**
 * "Send feedback": opens the phone's email app with a draft the user reads and edits before
 * sending. Only the app version and phone model are prefilled (shown in the draft); no logs or
 * other data are attached.
 */
export type FeedbackInfo = {
  version: string | null;
  build: string | null;
  device: string | null;
  os: string | null;
};

export function feedbackBody(info: FeedbackInfo): string {
  const app = `Sidekick ${info.version ?? '?'}${info.build ? ` (${info.build})` : ''}`;
  const phone = [info.device, info.os].filter(Boolean).join(', ');
  return [
    '',
    '',
    '— Added by Sidekick (edit or delete freely) —',
    app,
    phone ? `Phone: ${phone}` : null,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

export function feedbackMailto(to: string, info: FeedbackInfo): string {
  const subject = encodeURIComponent('Sidekick feedback');
  const body = encodeURIComponent(feedbackBody(info));
  return `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`;
}
