/** Chat colours. Off the record uses the dark set, so it is obvious at a glance. */
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

export const LIGHT: ChatTheme = {
  bg: '#ffffff',
  text: '#111111',
  faint: '#8a8a8f',
  userBubble: '#f0f0f3',
  userText: '#111111',
  field: '#f2f2f5',
  icon: '#333333',
  accent: '#111111',
  danger: '#b00020',
  card: '#f7f7f9',
  border: '#e6e6ea',
};

export const DARK: ChatTheme = {
  bg: '#0e0e10',
  text: '#ececf0',
  faint: '#8d8d96',
  userBubble: '#26262b',
  userText: '#ececf0',
  field: '#1d1d21',
  icon: '#d8d8de',
  accent: '#ececf0',
  danger: '#ff6b7a',
  card: '#1a1a1e',
  border: '#2a2a30',
};
