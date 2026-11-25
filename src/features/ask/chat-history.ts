import { getDb } from '@/memory/db';
import { type ChatMessage, HISTORY_EXCHANGES, historyToMessages } from './chat-logic';

/** The last saved exchanges (typed, spoken and photo questions), oldest first, for the chat. */
export async function loadChatHistory(exchanges = HISTORY_EXCHANGES): Promise<ChatMessage[]> {
  const db = await getDb();
  const r = await db.execute(
    "SELECT id, at, text, photo_path FROM moments WHERE kind IN ('answer', 'photo') AND text LIKE 'Q: %' ORDER BY at DESC LIMIT ?",
    [exchanges],
  );
  return historyToMessages(
    r.rows.map((row) => ({
      id: row.id as number,
      at: row.at as number,
      text: row.text as string,
      photoPath: (row.photo_path as string | null) ?? null,
    })),
  );
}
