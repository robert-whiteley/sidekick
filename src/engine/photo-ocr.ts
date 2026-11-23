import { Platform } from 'react-native';
import SidekickNative from '../../modules/sidekick-native';
import { formatOcr } from '@/memory/photo-text';
import { isDownloaded, modelPath } from './downloads';
import { OCR_FILES } from './models';

/** Photo OCR (PP-OCRv6 small) is Android-only for now, and needs its three files. */
export function ocrReady(): boolean {
  return Platform.OS === 'android' && Object.values(OCR_FILES).every(isDownloaded);
}

/**
 * The text in a photo as one line (null if none, or OCR isn't available). Sub-second on a
 * laptop CPU; runs on every saved photo and before every photo question.
 */
export async function readPhotoText(photoPath: string): Promise<string | null> {
  if (!ocrReady()) return null;
  const r = await SidekickNative.ocrPhoto(
    modelPath(OCR_FILES.det),
    modelPath(OCR_FILES.rec),
    modelPath(OCR_FILES.dict),
    photoPath,
  );
  console.log(`[ocr] ${r.lines.length} lines, ${Math.round(r.ms)} ms`);
  return formatOcr(r.lines);
}

/** Same, but never throws: a photo question still works without OCR. */
export async function photoTextOrNull(photoPath: string | null): Promise<string | null> {
  if (!photoPath) return null;
  try {
    return await readPhotoText(photoPath);
  } catch (e) {
    console.log(`[ocr] failed: ${String(e)}`);
    return null;
  }
}
