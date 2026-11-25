import { MODEL_FILES, type ModelFile } from './models';

/**
 * The chat models Sidekick can run, the Recommended one for this phone, and the update policy
 * (docs/PLAN-v2.md "Models", "Smart defaults"). The catalog ships inside the app, so nothing is
 * looked up online: a newer Recommended model arrives with an app update and is then fetched by
 * the update policy (Automatic: Wi-Fi + charging; Ask me; Off). Pure logic, tested; the
 * downloading and switching live in model-updates.ts.
 */

export type ChatModelId = 'gemma-4-e2b' | 'gemma-4-e4b';

export type CatalogModel = {
  id: ChatModelId;
  label: string;
  /** One plain line for the model list. */
  summary: string;
  /** Below this much RAM (as Android reports it) the model is not offered. */
  minRamMb: number;
  /** From this much RAM up it is the Recommended model. */
  recommendedRamMb: number;
  /** Speed relative to Gemma 4 E2B on the same phone (measured on reference phones). */
  relativeSpeed: number;
  /** Generic build, loaded on the GPU or CPU. */
  generic: ModelFile;
  /** Builds compiled for a Pixel's Tensor chip, by generation ("G5"). */
  tensor: Partial<Record<string, ModelFile>>;
};

export const CATALOG: CatalogModel[] = [
  {
    id: 'gemma-4-e2b',
    label: 'Gemma 4 E2B',
    summary: 'Quick answers; fits every supported phone.',
    minRamMb: 0,
    recommendedRamMb: 0,
    relativeSpeed: 1,
    generic: MODEL_FILES.gemmaGeneric,
    tensor: { G5: MODEL_FILES.gemmaTensorG5, G6: MODEL_FILES.gemmaTensorG6 },
  },
  {
    id: 'gemma-4-e4b',
    label: 'Gemma 4 E4B',
    summary: 'Smarter, about half the speed; needs a phone with lots of memory.',
    // 8 GB phones report ~7.3-7.6 GB, 12 GB phones ~11.2 GB.
    minRamMb: 7000,
    recommendedRamMb: 11000,
    relativeSpeed: 0.55,
    generic: MODEL_FILES.gemmaE4B,
    tensor: {},
  },
];

export const DEFAULT_CHAT: ChatModelId = 'gemma-4-e2b';

export function catalogModel(id: ChatModelId): CatalogModel {
  return CATALOG.find((m) => m.id === id) ?? CATALOG[0];
}

export type Device = { soc: string; totalRamMb: number };

/** Returns the Tensor generation ("G5", "G6") for a Pixel SoC string, or null. */
export function tensorGeneration(soc: string): string | null {
  const m = /tensor\s*(g\d+)/i.exec(soc);
  return m ? m[1].toUpperCase() : null;
}

/** Models this phone can run, smallest first. */
export function availableModels(d: Device): CatalogModel[] {
  return CATALOG.filter((m) => d.totalRamMb >= m.minRamMb || m.minRamMb === 0);
}

/** The best model this phone runs well: the most capable whose Recommended RAM it has. */
export function recommendedModel(d: Device): ChatModelId {
  let best = CATALOG[0];
  for (const m of CATALOG) if (d.totalRamMb >= m.recommendedRamMb) best = m;
  return best.id;
}

/** Files one model needs on this phone: the Tensor build when there is one, plus the generic. */
export function modelFilesFor(id: ChatModelId, soc: string): ModelFile[] {
  const m = catalogModel(id);
  const gen = tensorGeneration(soc);
  const t = gen ? m.tensor[gen] : undefined;
  return t ? [t, m.generic] : [m.generic];
}

export function bytesFor(id: ChatModelId, soc: string): number {
  return modelFilesFor(id, soc).reduce((n, f) => n + f.bytes, 0);
}

/**
 * What is in use. `previous` is set right after a switch, until the new model has loaded once:
 * it stays as the fallback, then its files are deleted.
 */
export type ActiveChat = { id: ChatModelId; sha: string; previous?: ChatModelId };

/** The user's pick: follow the Recommended model, or a fixed one. */
export type ChatChoice = 'recommended' | ChatModelId;

export function desiredModel(choice: ChatChoice, d: Device): ChatModelId {
  if (choice === 'recommended') return recommendedModel(d);
  // A fixed pick this phone can't run (e.g. restored settings) falls back to Recommended.
  return availableModels(d).some((m) => m.id === choice) ? choice : recommendedModel(d);
}

/** True when the wanted model (or a newer build of it) is not the one in use. */
export function needsSwitch(active: ActiveChat, want: ChatModelId): boolean {
  return active.id !== want || active.sha !== catalogModel(want).generic.sha256;
}

export type UpdatePolicy = 'auto' | 'ask' | 'off';
export type NetState = { wifi: boolean; charging: boolean };

/**
 * What to do about a better model. Automatic waits for Wi-Fi and charging (big file, no data
 * costs, no battery drain); Ask me asks once a day; Off never fetches. A user's own pick in the
 * model list is downloaded straight away (Wi-Fi only unless they said otherwise).
 */
export function planUpdate(
  policy: UpdatePolicy,
  net: NetState,
  userPicked: boolean,
): 'download' | 'wait' | 'ask' | 'none' {
  if (userPicked) return 'download';
  if (policy === 'off') return 'none';
  if (policy === 'ask') return 'ask';
  return net.wifi && net.charging ? 'download' : 'wait';
}

/** The files that can be deleted once [keep] has loaded fine (never a file [keep] uses). */
export function filesToDrop(old: ChatModelId, keep: ChatModelId, soc: string): ModelFile[] {
  const keepNames = new Set(modelFilesFor(keep, soc).map((f) => f.name));
  return modelFilesFor(old, soc).filter((f) => !keepNames.has(f.name));
}

/** "About 7 words a second on this phone", from the measured speed of Gemma 4 E2B. */
export function speedNote(id: ChatModelId, e2bTokPerSec: number | null): string {
  if (!e2bTokPerSec || e2bTokPerSec <= 0) return 'Speed measured after first use';
  const words = e2bTokPerSec * catalogModel(id).relativeSpeed * 0.75;
  return `About ${Math.max(1, Math.round(words))} words a second on this phone`;
}

/** "2.6 GB" */
export function formatGB(bytes: number): string {
  return bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}
