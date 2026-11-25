import { type Colors, DARK_COLORS, LIGHT_COLORS } from '@/ui';

/** Chat colours, derived from the app tokens. Off the record uses the dark set, so it is obvious at a glance. */
export type ChatTheme = {
  bg: string;
  text: string;
  faint: string;
  userBubble: string;
  userText: string;
  field: string;
  icon: string;
  accent: string;
  danger: string;
  card: string;
  border: string;
};

function chat(c: Colors): ChatTheme {
  return {
    bg: c.bg,
    text: c.text,
    faint: c.faint,
    userBubble: c.surfaceHigh,
    userText: c.text,
    field: c.surface,
    icon: c.icon,
    accent: c.text,
    danger: c.danger,
    card: c.surface,
    border: c.border,
  };
}

export const LIGHT: ChatTheme = chat(LIGHT_COLORS);
export const DARK: ChatTheme = chat(DARK_COLORS);
