/**
 * Finds the person named in a request ("Sam", "Mum", "Dr Patel") in the phone's contacts.
 * Asks for the Contacts permission the first time (in context). Read-only.
 */
import { isOn } from './prefs';

export type ContactMatch = {
  name: string;
  phones: string[];
  emails: string[];
  nickname?: string | null;
};

const FAMILY: Record<string, string[]> = {
  mum: ['mum', 'mom', 'mummy', 'mother', 'mam', 'ma'],
  dad: ['dad', 'daddy', 'father', 'pa'],
  nan: ['nan', 'nana', 'nanna', 'gran', 'granny', 'grandma'],
  grandad: ['grandad', 'grandpa', 'grandfather'],
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function aliases(name: string): string[] {
  const n = norm(name);
  for (const group of Object.values(FAMILY)) if (group.includes(n)) return group;
  return [n];
}

/**
 * The best contact for a spoken name: exact full name or nickname, then a unique first-name
 * match, then a unique "starts with". Several equal matches → null (the card asks who).
 */
export function bestContact(said: string, list: ContactMatch[]): ContactMatch | null {
  const wants = aliases(said);
  const score = (c: ContactMatch) => {
    const full = norm(c.name);
    const nick = norm(c.nickname ?? '');
    const first = full.split(' ')[0];
    if (wants.includes(full) || (nick && wants.includes(nick))) return 3;
    if (wants.includes(first)) return 2;
    if (wants.some((w) => w.length >= 3 && full.startsWith(w))) return 1;
    return 0;
  };
  let best: ContactMatch | null = null;
  let bestScore = 0;
  let tie = false;
  for (const c of list) {
    const s = score(c);
    if (s > bestScore) [best, bestScore, tie] = [c, s, false];
    else if (s === bestScore && s > 0) tie = true;
  }
  return bestScore > 0 && !tie ? best : null;
}

async function api() {
  return import('expo-contacts');
}

/** Contacts permission, asked once in context. */
export async function contactsAllowed(ask = true): Promise<boolean> {
  if (!isOn('contacts', 'read')) return false;
  const Contacts = await api();
  if ((await Contacts.getPermissionsAsync()).status === 'granted') return true;
  return ask && (await Contacts.requestPermissionsAsync()).status === 'granted';
}

export async function findContact(said: string): Promise<ContactMatch | null> {
  if (/^\+?[\d ()-]{6,}$/.test(said.trim())) {
    return { name: said.trim(), phones: [said.replace(/[^\d+]/g, '')], emails: [] };
  }
  if (/^\S+@\S+\.\S+$/.test(said.trim()))
    return { name: said.trim(), phones: [], emails: [said.trim()] };
  if (!(await contactsAllowed())) return null;
  const Contacts = await api();
  const fields = [
    Contacts.ContactField.FULL_NAME,
    Contacts.ContactField.NICKNAME,
    Contacts.ContactField.PHONES,
    Contacts.ContactField.EMAILS,
  ] as const;
  const first = aliases(said)[0];
  // Ask the system to filter by name; for "Mum" etc. scan everything (names vary).
  const rows = await Contacts.Contact.getAllDetails(
    fields,
    aliases(said).length > 1 ? {} : { name: first },
  );
  const list: ContactMatch[] = rows.map((c) => ({
    name: (c.fullName ?? '').trim(),
    nickname: c.nickname ?? null,
    phones: (c.phones ?? []).map((x) => String(x.number ?? '')).filter(Boolean),
    emails: (c.emails ?? []).map((x) => String(x.address ?? '')).filter(Boolean),
  }));
  return bestContact(said, list);
}

/** Names for splitting "text Sam Taylor I'm late" (empty without permission; never asks). */
export async function contactNameList(): Promise<string[]> {
  try {
    if (!(await contactsAllowed(false))) return [];
    const Contacts = await api();
    const rows = await Contacts.Contact.getAllDetails([Contacts.ContactField.FULL_NAME] as const);
    return rows.map((c) => (c.fullName ?? '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}
