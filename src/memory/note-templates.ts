/**
 * Note templates for live conversation notes: meeting, lecture, doctor's appointment, interview.
 * Off by default (the general note). Chosen by voice for the conversation going on ("this is a
 * meeting") or as a default in Settings → Assistant. The live-notes pass adds the template's lines
 * to its format (see `templateFormat`). Pure; tested in __tests__/voice-commands-test.ts.
 */

export type NoteTemplateId = 'meeting' | 'lecture' | 'doctor' | 'interview';

export type NoteTemplate = {
  id: NoteTemplateId;
  /** Shown in Settings and said back ("OK, meeting notes for this one."). */
  label: string;
  /** Extra sections asked of the model, one per line, in the note's "Name: …" format. */
  sections: string[];
};

export const NOTE_TEMPLATES: Record<NoteTemplateId, NoteTemplate> = {
  meeting: {
    id: 'meeting',
    label: 'Meeting',
    sections: [
      'Agenda: the items discussed, separated by ;',
      'Open questions: what is still undecided, separated by ;, or none',
    ],
  },
  lecture: {
    id: 'lecture',
    label: 'Lecture',
    sections: [
      'Key points: the main ideas explained, separated by ;',
      'Terms: new words or names with a short meaning, separated by ;, or none',
      'To read or do: anything set as homework or reading, separated by ;, or none',
    ],
  },
  doctor: {
    id: 'doctor',
    label: "Doctor's appointment",
    sections: [
      'Symptoms: what was described, separated by ;, or none',
      'Diagnosis: what the doctor said it is, or none',
      'Medicines: name, dose and how often, exactly as said, separated by ;, or none',
      'Next steps: tests, referrals, follow-up dates, separated by ;, or none',
    ],
  },
  interview: {
    id: 'interview',
    label: 'Interview',
    sections: [
      'Questions asked: separated by ;',
      'Answers: the main point of each answer, separated by ;',
      'Next steps: what happens next and when, or none',
    ],
  },
};

/** A voice choice applies to the conversation going on, or one starting within this long. */
export const CHOICE_REACH_MS = 15 * 60_000;

/** The user's "this is a meeting" choice: which template, said when. */
export type TemplateChoice = { id: NoteTemplateId | null; at: number };

/**
 * The template for a conversation running [from]..[to]: a voice choice said during it (or up to
 * CHOICE_REACH_MS before it started) wins; else the default from Settings (null = general note).
 */
export function templateFor(
  conv: { from: number; to: number },
  choice: TemplateChoice | null,
  fallback: NoteTemplateId | null,
): NoteTemplate | null {
  if (choice && choice.at >= conv.from - CHOICE_REACH_MS && choice.at <= conv.to + 60_000)
    return choice.id ? NOTE_TEMPLATES[choice.id] : null;
  return fallback ? NOTE_TEMPLATES[fallback] : null;
}

/** The format lines to add to the note prompt for [t] (empty for the general note). */
export function templateFormat(t: NoteTemplate | null): string {
  return t ? `\n${t.sections.join('\n')}` : '';
}

/** Parses the template's extra sections out of a model reply ("Agenda: a; b"). */
export function parseTemplateSections(
  t: NoteTemplate | null,
  reply: string,
): { name: string; items: string[] }[] {
  if (!t) return [];
  const out: { name: string; items: string[] }[] = [];
  for (const s of t.sections) {
    const name = s.slice(0, s.indexOf(':'));
    const m = new RegExp(
      `^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(.*)$`,
      'im',
    ).exec(reply);
    if (!m) continue;
    const items = m[1]
      .split(';')
      .map((x) => x.trim())
      .filter((x) => x && !/^none\.?$/i.test(x));
    if (items.length) out.push({ name, items });
  }
  return out;
}
