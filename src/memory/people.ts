/**
 * People: automatic labels and names, notes, facts about them, what the owner asked of them, and
 * their recent conversations. Pure parts live in people-logic.ts.
 */
import { getDb } from './db';
import { formatDue, type Followup, newProposals } from './followup-logic';
import { listFollowups, notifyFollowupsChanged } from './followups';
import {
  conversationsWith,
  type ConversationSummary,
  findRequest,
  mentionedPerson,
  nextLabelNo,
  type PersonRef,
  personByName,
  personContext,
  requestFollowup,
  selfFacts,
  CONVERSATION_GAP_MS,
} from './people-logic';
import { addresseeOf, ADDRESS_WINDOW_MS } from './names';

export type KeptLine = {
  id: number;
  at: number;
  speakerId: number | null;
  isOwner: boolean;
  text: string;
};

/** Gives a new voice the next "Person N" label (stable for that voice from then on). */
export async function assignLabel(speakerId: number) {
  const db = await getDb();
  const r = await db.execute('SELECT label_no FROM speakers WHERE is_owner = 0');
  const n = nextLabelNo(r.rows.map((x) => (x.label_no as number | null) ?? null));
  await db.execute('UPDATE speakers SET label_no = ? WHERE id = ? AND label_no IS NULL', [
    n,
    speakerId,
  ]);
}

/**
 * "My name is Sam": names the voice right away, marked auto (undo or rename on their page).
 * Never overrides a name the user gave or a name they dismissed for this voice.
 */
export async function applyAutoName(speakerId: number, name: string): Promise<boolean> {
  const db = await getDb();
  const r = await db.execute('SELECT name, is_owner, dismissed_names FROM speakers WHERE id = ?', [
    speakerId,
  ]);
  const row = r.rows[0];
  if (!row || row.name || row.is_owner === 1) return false;
  if (
    String(row.dismissed_names ?? '')
      .split('|')
      .includes(name)
  )
    return false;
  await db.execute(
    'UPDATE speakers SET name = ?, name_auto = 1, suggested_name = NULL, suggested_count = 0 WHERE id = ?',
    [name, speakerId],
  );
  return true;
}

/** Auto name was wrong: back to "Person N", and never apply that name to this voice again. */
export async function undoAutoName(speakerId: number) {
  const db = await getDb();
  await db.execute(
    "UPDATE speakers SET dismissed_names = dismissed_names || '|' || name, name = NULL, name_auto = 0 WHERE id = ? AND name_auto = 1",
    [speakerId],
  );
}

/** Auto name is right: keep it as if the user typed it. */
export async function confirmAutoName(speakerId: number) {
  const db = await getDb();
  await db.execute('UPDATE speakers SET name_auto = 0 WHERE id = ?', [speakerId]);
}

export async function setPersonNotes(speakerId: number, notes: string) {
  const db = await getDb();
  await db.execute('UPDATE speakers SET notes = ? WHERE id = ?', [notes, speakerId]);
}

async function people(): Promise<(PersonRef & { notes: string })[]> {
  const db = await getDb();
  const r = await db.execute('SELECT id, name, is_owner, label_no, notes FROM speakers');
  return r.rows.map((x) => ({
    id: x.id as number,
    name: (x.name as string | null) ?? null,
    isOwner: x.is_owner === 1,
    labelNo: (x.label_no as number | null) ?? null,
    notes: (x.notes as string | null) ?? '',
  }));
}

/** Labels for every voice, keyed by id (for the live transcript). */
export async function peopleById(): Promise<Map<number, PersonRef>> {
  return new Map((await people()).map((p) => [p.id, p]));
}

/**
 * From newly kept lines: requests the owner gave someone ("Sam, can you …" → a follow-up linked
 * to Sam) and things other people said about themselves (suggested facts on their page).
 */
export async function collectPersonInfo(lines: KeptLine[], now = new Date()) {
  const db = await getDb();
  for (const line of lines) {
    if (line.isOwner) {
      const req = findRequest(line.text);
      if (!req) continue;
      let personId = personByName(req.name, await people())?.id ?? null;
      if (personId == null) {
        const r = await db.execute(
          'SELECT m.at, m.speaker_id, s.is_owner FROM moments m JOIN speakers s ON s.id = m.speaker_id WHERE m.at BETWEEN ? AND ?',
          [line.at - ADDRESS_WINDOW_MS, line.at + ADDRESS_WINDOW_MS],
        );
        personId = addresseeOf(
          line,
          r.rows.map((x) => ({
            at: x.at as number,
            speakerId: x.speaker_id as number,
            isOwner: x.is_owner === 1,
          })),
        );
      }
      await addPersonRequest(req, personId, line.id, now);
    } else if (line.speakerId != null) {
      for (const quote of selfFacts(line.text)) await addPersonFact(line.speakerId, quote);
    }
  }
}

/**
 * Saved as a suggested follow-up (the follow-ups rule: nothing is acted on without approval),
 * linked to the person. Without a known person the name stays in the title.
 */
async function addPersonRequest(
  req: { name: string; task: string },
  personId: number | null,
  momentId: number,
  now: Date,
) {
  const f = requestFollowup(req, now);
  const title = personId == null ? `${req.name}: ${f.title}` : f.title;
  const db = await getDb();
  const existing =
    // Dismissed ones count too, so a request the user dismissed isn't proposed again.
    (await db.execute('SELECT title, due_at FROM followups')).rows.map((r) => ({
      title: r.title as string,
      dueAt: (r.due_at as number | null) ?? null,
    }));
  if (!newProposals([{ ...f, title }], existing).length) return;
  await db.execute(
    "INSERT INTO followups (kind, title, due_at, all_day, when_text, status, created_at, source_moment_id, person_id) VALUES (?, ?, ?, ?, ?, 'suggested', ?, ?, ?)",
    [f.kind, title, f.dueAt, f.allDay ? 1 : 0, f.whenText, now.getTime(), momentId, personId],
  );
  notifyFollowupsChanged();
}

async function addPersonFact(speakerId: number, quote: string) {
  const db = await getDb();
  const r = await db.execute(
    'SELECT 1 FROM facts WHERE speaker_id = ? AND lower(text) = lower(?)',
    [speakerId, quote],
  );
  if (r.rows.length) return;
  await db.execute(
    "INSERT INTO facts (text, status, at, speaker_id) VALUES (?, 'suggested', ?, ?)",
    [quote, Date.now(), speakerId],
  );
}

export type PersonFact = { id: number; text: string; status: 'saved' | 'suggested' };

export async function personFacts(speakerId: number): Promise<PersonFact[]> {
  const db = await getDb();
  const r = await db.execute(
    'SELECT id, text, status FROM facts WHERE speaker_id = ? ORDER BY at DESC',
    [speakerId],
  );
  return r.rows.map((x) => ({
    id: x.id as number,
    text: x.text as string,
    status: x.status as PersonFact['status'],
  }));
}

/** Suggested → saved (the same approval as the owner's suggested facts). */
export async function approvePersonFact(factId: number) {
  const db = await getDb();
  await db.execute("UPDATE facts SET status = 'saved' WHERE id = ?", [factId]);
}

/** What the owner asked this person to do (not dismissed), newest first. */
export async function personRequests(speakerId: number): Promise<Followup[]> {
  return (await listFollowups()).filter((f) => f.personId === speakerId);
}

/** Their last few conversations, with everyone's lines in them. */
export async function personConversations(
  speakerId: number,
  limit = 5,
): Promise<ConversationSummary[]> {
  const db = await getDb();
  const theirs = await db.execute(
    "SELECT at FROM moments WHERE speaker_id = ? AND kind IN ('speech', 'question') ORDER BY at DESC LIMIT 400",
    [speakerId],
  );
  if (!theirs.rows.length) return [];
  const newest = theirs.rows[0].at as number;
  const oldest = theirs.rows[theirs.rows.length - 1].at as number;
  const r = await db.execute(
    "SELECT id, at, text, speaker_id FROM moments WHERE kind IN ('speech', 'question') AND at BETWEEN ? AND ? ORDER BY at DESC LIMIT 2000",
    [oldest - CONVERSATION_GAP_MS, newest + CONVERSATION_GAP_MS],
  );
  return conversationsWith(
    r.rows.map((x) => ({
      id: x.id as number,
      at: x.at as number,
      text: x.text as string,
      speakerId: (x.speaker_id as number | null) ?? null,
    })),
    speakerId,
  ).slice(0, limit);
}

/**
 * "What did I ask Sam to do?", "where does Sam live?": the named person's notes, approved facts
 * and requests, for the prompt. '' when no known person is named.
 */
export async function personPromptContext(question: string, now = new Date()): Promise<string> {
  const p = mentionedPerson(question, await people());
  if (!p?.name) return '';
  const [facts, requests] = await Promise.all([personFacts(p.id), personRequests(p.id)]);
  return personContext(p.name, {
    notes: p.notes,
    facts: facts.filter((f) => f.status === 'saved').map((f) => f.text),
    requests: requests.slice(0, 10).map((f) => ({
      title: f.title,
      status: f.status,
      due: formatDue(f, now),
    })),
  });
}
