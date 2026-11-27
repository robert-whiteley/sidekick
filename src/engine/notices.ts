/**
 * System notices in the chat. Two kinds, by design (docs/PLAN-v2.md "System notices"):
 * - 'info': something changed by itself (frame rate lowered for heat, camera unplugged). Shown
 *   as one faint, small line; tapping opens `href` (the matching setting, with an override).
 *   Same `key` again replaces the earlier line instead of adding one (no spam).
 * - 'decision': needs the user (storage will run out). Shown as a chat card with `actions`.
 *   At most once a day per key unless `severity` rises.
 * Pure state + listeners; the chat screen renders them. Tested.
 */

export type NoticeAction = { label: string; id: string };

export type Notice = {
  key: string;
  kind: 'info' | 'decision';
  text: string;
  /** Expo Router path of the setting to open, e.g. '/settings/camera#fps'. */
  href?: string;
  actions?: NoticeAction[];
  severity?: number;
  /**
   * An approval card (a critical settings change, settings-registry.ts): its buttons work only
   * from armAt (a short delay, so a tap meant for something else can't approve it) until
   * expiresAt, when the card goes away by itself.
   */
  armAt?: number;
  expiresAt?: number;
  at: number;
};

/** How long an approval card waits before its button works, and how long it stays. */
export const APPROVE_ARM_MS = 1500;
export const APPROVE_EXPIRES_MS = 2 * 60_000;

/** Whether a tap on a card's button counts now (approval cards: armed and not expired). */
export function actionable(n: Pick<Notice, 'armAt' | 'expiresAt'>, now: number): boolean {
  if (n.armAt !== undefined && now < n.armAt) return false;
  if (n.expiresAt !== undefined && now >= n.expiresAt) return false;
  return true;
}

const DECISION_REPEAT_MS = 24 * 60 * 60_000;

export class Notices {
  private items: Notice[] = [];
  private lastDecision = new Map<string, { at: number; severity: number }>();
  private listeners = new Set<(n: Notice[]) => void>();
  private handlers = new Map<string, (actionId: string) => void>();

  get all(): Notice[] {
    return this.items;
  }

  /** Adds or replaces (same key) a notice; returns false when a decision was held back. */
  post(n: Omit<Notice, 'at'> & { at?: number }, onAction?: (actionId: string) => void): boolean {
    const at = n.at ?? Date.now();
    if (n.kind === 'decision') {
      const prev = this.lastDecision.get(n.key);
      const sev = n.severity ?? 0;
      if (prev && at - prev.at < DECISION_REPEAT_MS && sev <= prev.severity) return false;
      this.lastDecision.set(n.key, { at, severity: sev });
    }
    if (onAction) this.handlers.set(n.key, onAction);
    this.items = [...this.items.filter((x) => x.key !== n.key), { ...n, at }];
    this.emit();
    return true;
  }

  /** A tap on a card's button; false when the card isn't armed yet (it stays) or has expired. */
  act(key: string, actionId: string, now = Date.now()): boolean {
    const n = this.items.find((x) => x.key === key);
    if (n && !actionable(n, now)) {
      if (n.expiresAt !== undefined && now >= n.expiresAt) this.dismiss(key);
      return false;
    }
    this.handlers.get(key)?.(actionId);
    this.dismiss(key);
    return true;
  }

  /** Drops approval cards whose time is up. */
  expire(now = Date.now()) {
    const left = this.items.filter((x) => x.expiresAt === undefined || now < x.expiresAt);
    if (left.length === this.items.length) return;
    this.items = left;
    this.emit();
  }

  dismiss(key: string) {
    this.items = this.items.filter((x) => x.key !== key);
    this.emit();
  }

  subscribe(l: (n: Notice[]) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit() {
    this.listeners.forEach((l) => l(this.items));
  }
}

/** The one notice list for this app session. */
export const notices = new Notices();
