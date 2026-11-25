import SidekickNative from '../../modules/sidekick-native';
import type { ChatState, Turn } from '@/engine/conversation';

/** The continuous chat's running summary and recent turns, kept across app restarts. */
export const CHAT_STATE_KEY = 'chat.state.v1';

const isTurn = (t: unknown): t is Turn =>
  !!t &&
  typeof (t as Turn).q === 'string' &&
  typeof (t as Turn).a === 'string' &&
  typeof (t as Turn).at === 'number';

export function parseChatState(raw: string | null): ChatState {
  try {
    const v = JSON.parse(raw ?? '') as Partial<ChatState>;
    return {
      summary: typeof v.summary === 'string' ? v.summary : '',
      turns: Array.isArray(v.turns) ? v.turns.filter(isTurn) : [],
    };
  } catch {
    return { summary: '', turns: [] };
  }
}

export function loadChatState(): ChatState {
  try {
    return parseChatState(SidekickNative.kvGet(CHAT_STATE_KEY));
  } catch {
    return { summary: '', turns: [] };
  }
}

export function saveChatState(s: ChatState) {
  try {
    SidekickNative.kvSet(CHAT_STATE_KEY, JSON.stringify(s));
  } catch (e) {
    console.log(`[chat] state not saved: ${String(e)}`);
  }
}

/** Delete all data: the summary and turns go too. */
export function clearChatState() {
  try {
    SidekickNative.kvSet(CHAT_STATE_KEY, null);
  } catch {
    // nothing saved
  }
}
