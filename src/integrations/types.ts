/**
 * Actions Sidekick can take in other apps. Anything that sends something to another person
 * (message, email, call) or changes the calendar is a Draft first: the chat shows it as a card
 * (Send / Edit / Cancel / Open in app) and nothing leaves the phone until the user taps Send or
 * says "send it". See docs/decisions/0008-integrations.md.
 */

export type DraftKind = 'message' | 'email' | 'event' | 'call';

/** Where a message goes. 'auto' = the app the person was last messaged in, else SMS. */
export type MessageApp = 'whatsapp' | 'sms' | 'telegram' | 'signal' | 'auto';

export type DraftStatus = 'draft' | 'queued' | 'sent' | 'failed' | 'cancelled';

export type MessageFields = {
  /** Name as said ("Sam"); `to` is the resolved number, if any. */
  name: string;
  to: string | null;
  text: string;
  app: MessageApp;
  /** Set when replying: the notification this answers (sent via its reply action). */
  replyKey?: string;
};

export type EmailFields = {
  name: string;
  to: string | null;
  subject: string;
  body: string;
};

export type EventFields = {
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location: string;
  /** Editing an existing event instead of adding one. */
  eventId?: string;
};

export type CallFields = { name: string; to: string | null };

export type DraftFieldsByKind = {
  message: MessageFields;
  email: EmailFields;
  event: EventFields;
  call: CallFields;
};

export type Draft<K extends DraftKind = DraftKind> = {
  [P in K]: {
    id: string;
    kind: P;
    /** One line for the card header, e.g. "Message to Sam (WhatsApp)". */
    title: string;
    fields: DraftFieldsByKind[P];
    /** Registry id of the integration that runs it (see registry.ts). */
    integration: string;
    status: DraftStatus;
    /** Short reason when failed or queued ("Waiting for internet"). */
    note?: string;
    at: number;
  };
}[K];

/** What the chat should do with a request. */
export type PlannedAction =
  /** Show a card and wait for Send. */
  | { kind: 'draft'; draft: Draft }
  /** Already done (alarm set, music paused) or an answer (what's playing): say this. */
  | { kind: 'reply'; text: string };
