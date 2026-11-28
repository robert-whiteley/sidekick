/** The choices Settings offers for the adjustable values (pure; shared by the screens and the settings registry). */
export const FPS_OPTIONS = [0.5, 1, 2];
export const FRAME_WINDOW_OPTIONS = [1, 2, 3];
export const VIDEO_KEEP_OPTIONS = [2, 6, 12, 24, 48, 72, 168, 720]; // hours: 2 h … 1 month
export const AUDIO_KEEP_OPTIONS = [7, 30, 90, 365, 0]; // days; 0 = forever
export const RESERVE_OPTIONS = [1, 2, 4, 8, 16];

/** Phone search: the lowest battery level for reading photos on battery (percent). */
export const BATTERY_FLOORS = [20, 30, 50, 70] as const;
