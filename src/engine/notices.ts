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
  at: number;
};

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

  act(key: string, actionId: string) {
    this.handlers.get(key)?.(actionId);
    this.dismiss(key);
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
