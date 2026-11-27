import {
  amountsIn,
  answerPrompt,
  fileBody,
  fileKeyOf,
  fileUriOf,
  type Found,
  inRange,
  isImageFile,
  libraryItem,
  nameWords,
  orderFound,
  parsePick,
  PHOTO_BUDGET,
  photoDuty,
  photoIndexText,
  pickPrompt,
  planGallery,
  refillBudget,
  splitFileText,
  updateCost,
} from '@/memory/gallery-logic';
import { fileItems, fileKeyPrefix } from '@/memory/sources-logic';

const item = (key: string, at: number, ver = String(at)) => ({
  key,
  ver,
  at,
  name: `${key}.jpg`,
  origin: 'library',
});

describe('planGallery', () => {
  it('adds new photos, re-reads changed ones and removes deleted ones', () => {
    const existing = [
      { id: 1, key: 'a', ver: '10' },
      { id: 2, key: 'b', ver: '20' },
      { id: 3, key: 'gone', ver: '5' },
    ];
    const plan = planGallery(existing, [item('a', 10), item('b', 25), item('c', 30)]);
    expect(plan.insert.map((i) => i.key)).toEqual(['c']);
    expect(plan.update).toEqual([expect.objectContaining({ id: 2, key: 'b', ver: '25' })]);
    expect(plan.remove).toEqual([3]);
  });
  it('keeps only the newest photos', () => {
    const plan = planGallery([], [item('old', 1), item('new', 3), item('mid', 2)], 2);
    expect(plan.insert.map((i) => i.key).sort()).toEqual(['mid', 'new']);
  });
  it('removes everything when access is taken back', () => {
    expect(planGallery([{ id: 7, key: 'a', ver: '1' }], []).remove).toEqual([7]);
  });
});

describe('library items and images', () => {
  it('uses the creation time, else the modification time', () => {
    const a = { id: 'ph://x', filename: 'IMG_1.HEIC', creationTime: 5, modificationTime: 9 };
    expect(libraryItem(a)).toEqual({
      key: 'ph://x',
      ver: '9',
      at: 5,
      name: 'IMG_1.HEIC',
      origin: 'library',
    });
    expect(libraryItem({ ...a, creationTime: null }).at).toBe(9);
  });
  it('knows image files and screenshots', () => {
    expect(isImageFile('Receipt.JPG')).toBe(true);
    expect(isImageFile('scan.heic')).toBe(true);
    expect(isImageFile('notes.txt')).toBe(false);
    expect(isImageFile('.hidden.png')).toBe(false);
    expect(photoIndexText('Screenshot_20261120.png', 'Leeds 10:05')).toBe(
      'Screenshot. Leeds 10:05',
    );
    expect(photoIndexText('IMG_1.jpg', null)).toBe('');
  });
});

const found = (title: string, at: number, kind: Found['kind'] = 'file'): Found => ({
  kind,
  ref: title,
  title,
  at,
  excerpt: `text of ${title}`,
});

describe('results', () => {
  it('orders newest first only when the newest is wanted', () => {
    const list = [found('best', 1), found('newer', 3), found('mid', 2)];
    expect(orderFound(list, false).map((f) => f.title)).toEqual(['best', 'newer', 'mid']);
    expect(orderFound(list, true).map((f) => f.title)).toEqual(['newer', 'mid', 'best']);
    expect(orderFound(list, true, 2).map((f) => f.title)).toEqual(['newer', 'best']);
  });
  it('filters by time', () => {
    const list = [found('a', 1), found('b', 5), found('c', 9)];
    expect(inRange(list, 2, 9).map((f) => f.title)).toEqual(['b']);
    expect(inRange(list).length).toBe(3);
  });
  it('reads the pick, refusing numbers out of the list', () => {
    expect(parsePick('2', 3)).toBe(1);
    expect(parsePick('[3] the newest', 3)).toBe(2);
    expect(parsePick('0', 3)).toBe(-1);
    expect(parsePick('7', 3)).toBe(-1);
    expect(parsePick('none', 3)).toBe(-1);
  });
  it('lists every result with its date for the pick', () => {
    const p = pickPrompt('latest invoice from Acme', [found('Bills/acme.pdf', 0)], true);
    expect(p).toContain('[1] File Bills/acme.pdf, ');
    expect(p).toContain('newest first');
  });
});

describe('files', () => {
  const folder = 'content://tree/Docs';
  const uri = 'content://tree/Docs/document/acme.pdf';
  it('finds the whole file from one passage key', () => {
    const items = fileItems(folder, uri, 'Docs/acme.pdf', 100, 'a'.repeat(3000), '100');
    const key = fileKeyOf(items[1].key)!;
    expect(key).toBe(fileKeyPrefix(folder, uri));
    expect(fileUriOf(key)).toBe(uri);
    expect(fileKeyOf('note:1')).toBeNull();
  });
  it('splits the file header from the text', () => {
    expect(splitFileText('File Docs/acme.pdf (part 2):\nTotal £21.60')).toEqual({
      path: 'Docs/acme.pdf',
      body: 'Total £21.60',
    });
    expect(splitFileText('plain').body).toBe('plain');
  });
  it('joins passages in order and keeps the end of a long file', () => {
    const body = fileBody([
      { n: 1, text: 'File x (part 2):\nTotal due £99.00' },
      { n: 0, text: 'File x:\nInvoice from Acme' },
    ]);
    expect(body).toBe('Invoice from Acme\n\nTotal due £99.00');
    const long = fileBody([{ n: 0, text: `${'x'.repeat(10_000)} Total £5` }], 1000);
    expect(long.length).toBeLessThan(1010);
    expect(long.endsWith('Total £5')).toBe(true);
  });
});

describe('amounts', () => {
  it('finds money amounts in any common form, once each', () => {
    expect(amountsIn('Subtotal £18.00 VAT £3.60 Total £21.60 Total £21.60')).toEqual([
      '£18.00',
      '£3.60',
      '£21.60',
    ]);
    expect(amountsIn('Amount 1,200.50 EUR and $ 15')).toEqual(['1,200.50 EUR', '$ 15']);
    expect(amountsIn('Order 12345 on 3 Dec')).toEqual([]);
  });
  it('puts the exact amounts in the answer prompt', () => {
    const p = answerPrompt('how much was it', found('acme.pdf', 0), 'Total £21.60');
    expect(p).toContain('Amounts written in it: £21.60');
    expect(p).toContain('The file acme.pdf');
  });
});

describe('instant words from the name', () => {
  it('keeps words, drops numbers, camera prefixes and the extension', () => {
    expect(nameWords('Screenshot_20261127-100512_Chrome.jpg')).toBe('Screenshot Chrome');
    expect(nameWords('PXL_20261127_101500123.jpg')).toBe('');
    expect(nameWords('parking sign (2).HEIC')).toBe('parking sign');
    expect(photoIndexText('Screenshot_20261127-100512_Trainline.png', null)).toBe(
      'Screenshot Trainline',
    );
  });
});

describe('slow photo work budget', () => {
  const cool = { charging: false, batteryLevel: 1, lowPowerMode: false, thermalStatus: 0 };
  it('runs fully on a charger that keeps up, not when hot or draining', () => {
    expect(photoDuty({ ...cool, charging: true })).toBe(1);
    expect(photoDuty({ ...cool, charging: true, drainingOnCharger: true })).toBe(0);
    expect(photoDuty({ ...cool, charging: true, thermalStatus: 2 })).toBe(0);
  });
  it('on battery: a small share that shrinks with the level, none when low, saving or warm', () => {
    expect(photoDuty(cool)).toBeCloseTo(PHOTO_BUDGET.maxDuty);
    expect(photoDuty({ ...cool, batteryLevel: 0.65 })).toBeCloseTo(PHOTO_BUDGET.maxDuty / 2);
    expect(photoDuty({ ...cool, batteryLevel: 0.29 })).toBe(0);
    expect(photoDuty({ ...cool, lowPowerMode: true })).toBe(0);
    expect(photoDuty({ ...cool, thermalStatus: 1 })).toBe(0);
  });
  it('saves up time at the duty, capped', () => {
    expect(refillBudget(0, 0, 100_000, 0.02)).toBe(2000);
    expect(refillBudget(0, 0, 10_000_000, 0.02)).toBe(PHOTO_BUDGET.capMs);
    expect(refillBudget(500, 10, 5, 0.02)).toBe(500);
  });
  it('learns the cost per photo from what it measures', () => {
    expect(updateCost(null, 6500)).toBe(6500);
    expect(updateCost(2000, 3000)).toBe(2300);
  });
  it('on a full battery a photo costs about 8 s, so about 9 photos an hour', () => {
    expect(Math.round((3_600_000 * photoDuty(cool)) / 8000)).toBe(9);
  });
});
