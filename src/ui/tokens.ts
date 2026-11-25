/**
 * The one source of design tokens (colour, spacing, radius, type). Material 3 roles, neutral with
 * one blue accent. Screens use these through src/ui components; see ARCHITECTURE.md "UI".
 */
export type Colors = {
  /** Page background. */
  bg: string;
  /** Cards, dialogs, input fields. */
  surface: string;
  /** Raised containers on a surface (selected rows, the user's bubble). */
  surfaceHigh: string;
  text: string;
  /** Supporting text, hints, captions. */
  muted: string;
  /** Faint lines (system notices). */
  faint: string;
  border: string;
  primary: string;
  onPrimary: string;
  /** Tonal buttons and the selected segment. */
  primaryContainer: string;
  onPrimaryContainer: string;
  danger: string;
  onDanger: string;
  /** Touch feedback. */
  ripple: string;
  /** Dimmed backdrop behind dialogs. */
  scrim: string;
  /** Media (video player, camera) backgrounds and the text on them. */
  media: string;
  onMedia: string;
  /** Controls floating over a photo or video (camera close, Live toggle). */
  mediaScrim: string;
  /** Recording / live capture in progress (same red on light and dark). */
  recording: string;
  /** Positive state (saved, connected). */
  success: string;
  /** Warning state (storage low, paused). */
  warning: string;
  /** Chat icons. */
  icon: string;
};

export const LIGHT_COLORS: Colors = {
  bg: '#ffffff',
  surface: '#f4f5f8',
  surfaceHigh: '#e9ebf0',
  text: '#16181d',
  muted: '#5c616b',
  faint: '#8a8f99',
  border: '#dfe2e8',
  primary: '#2f5fd0',
  onPrimary: '#ffffff',
  primaryContainer: '#dce5fb',
  onPrimaryContainer: '#0f2a6b',
  danger: '#b3261e',
  onDanger: '#ffffff',
  ripple: 'rgba(22,24,29,0.10)',
  scrim: 'rgba(0,0,0,0.40)',
  media: '#000000',
  onMedia: '#ffffff',
  mediaScrim: 'rgba(0,0,0,0.45)',
  recording: '#c62828',
  success: '#1e7a3c',
  warning: '#8a5a00',
  icon: '#2b2e35',
};

export const DARK_COLORS: Colors = {
  bg: '#0f1013',
  surface: '#1b1d22',
  surfaceHigh: '#262930',
  text: '#eceef2',
  muted: '#a7acb6',
  faint: '#80858f',
  border: '#30333b',
  primary: '#a9c1ff',
  onPrimary: '#0f2a6b',
  primaryContainer: '#27427f',
  onPrimaryContainer: '#dce5fb',
  danger: '#ffb4ab',
  onDanger: '#690005',
  ripple: 'rgba(236,238,242,0.12)',
  scrim: 'rgba(0,0,0,0.60)',
  media: '#000000',
  onMedia: '#ffffff',
  mediaScrim: 'rgba(0,0,0,0.45)',
  recording: '#c62828',
  success: '#7fd99a',
  warning: '#f0c060',
  icon: '#d8dbe2',
};

/** Spacing on a 4 dp grid. */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, full: 999 } as const;

/** Minimum touch target (Material / Android accessibility). */
export const TOUCH = 48;

/** Material 3 type scale (sizes in sp; they follow the phone's font size setting). */
export const type = {
  headline: { fontSize: 24, lineHeight: 32, fontWeight: '400' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '400' },
  titleSmall: { fontSize: 18, lineHeight: 24, fontWeight: '500' },
  /** Chat messages: a touch larger for reading. */
  chat: { fontSize: 17, lineHeight: 25, fontWeight: '400' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '500' },
  bodySmall: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  /** Small status badges (Online, Live). */
  badge: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
} as const;

export type TypeVariant = keyof typeof type;

/** Categorical colours for charts (storage by kind); readable on light and dark. */
export const chart = ['#2f6fed', '#5b8def', '#8a63d2', '#e07a2f', '#2f9e6e', '#9aa0a6'] as const;
