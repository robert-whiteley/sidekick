/**
 * What kind of file something is, from its name, its type (MIME) and its first bytes; and what
 * to call it in plain words. Pure.
 */

export type FileType =
  | 'pdf'
  | 'text'
  | 'html'
  | 'rtf'
  | 'docx'
  | 'pptx'
  | 'odt'
  | 'odp'
  | 'xlsx'
  | 'xls'
  | 'ods'
  | 'csv'
  | 'tsv'
  | 'epub'
  | 'image'
  | 'audio'
  | 'video'
  | 'zip'
  | 'other';

export const TYPE_LABEL: Record<FileType, string> = {
  pdf: 'PDF',
  text: 'Text',
  html: 'Web page',
  rtf: 'Document',
  docx: 'Word document',
  pptx: 'Slides',
  odt: 'Document',
  odp: 'Slides',
  xlsx: 'Spreadsheet',
  xls: 'Spreadsheet',
  ods: 'Spreadsheet',
  csv: 'Spreadsheet',
  tsv: 'Spreadsheet',
  epub: 'E-book',
  image: 'Picture',
  audio: 'Recording',
  video: 'Video',
  zip: 'Zip',
  other: 'File',
};

const BY_EXT: Record<string, FileType> = {
  pdf: 'pdf',
  txt: 'text',
  text: 'text',
  md: 'text',
  markdown: 'text',
  log: 'text',
  json: 'text',
  jsonl: 'text',
  ndjson: 'text',
  xml: 'text',
  yaml: 'text',
  yml: 'text',
  toml: 'text',
  ini: 'text',
  cfg: 'text',
  conf: 'text',
  srt: 'text',
  vtt: 'text',
  ics: 'text',
  vcf: 'text',
  tex: 'text',
  rst: 'text',
  org: 'text',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  mht: 'html',
  rtf: 'rtf',
  docx: 'docx',
  docm: 'docx',
  dotx: 'docx',
  pptx: 'pptx',
  pptm: 'pptx',
  ppsx: 'pptx',
  odt: 'odt',
  ott: 'odt',
  odp: 'odp',
  xlsx: 'xlsx',
  xlsm: 'xlsx',
  xls: 'xls',
  ods: 'ods',
  csv: 'csv',
  tsv: 'tsv',
  tab: 'tsv',
  epub: 'epub',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  heic: 'image',
  heif: 'image',
  bmp: 'image',
  m4a: 'audio',
  mp3: 'audio',
  aac: 'audio',
  ogg: 'audio',
  oga: 'audio',
  opus: 'audio',
  wav: 'audio',
  amr: 'audio',
  flac: 'audio',
  wma: 'audio',
  mp4: 'video',
  m4v: 'video',
  mov: 'video',
  '3gp': 'video',
  webm: 'video',
  mkv: 'video',
  avi: 'video',
  zip: 'zip',
};

const BY_MIME: Record<string, FileType> = {
  'application/pdf': 'pdf',
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'text/csv': 'csv',
  'text/comma-separated-values': 'csv',
  'text/tab-separated-values': 'tsv',
  'application/json': 'text',
  'application/xml': 'text',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/epub+zip': 'epub',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
};

export const extOf = (name: string | undefined) => {
  const n = (name ?? '').toLowerCase();
  const dot = n.lastIndexOf('.');
  return dot < 0 ? '' : n.slice(dot + 1);
};

/** The kind of file, from its name first (types sent by apps are often generic), then its type. */
export function fileType(name: string | undefined, mime: string | undefined): FileType {
  const byExt = BY_EXT[extOf(name)];
  if (byExt) return byExt;
  const m = (mime ?? '').toLowerCase().split(';')[0].trim();
  if (BY_MIME[m]) return BY_MIME[m];
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('text/')) return 'text';
  return 'other';
}

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);
const ascii = (b: Uint8Array, at: number, n: number) =>
  String.fromCharCode(...Array.from(b.subarray(at, at + n)));

/** The kind from the first bytes, where they say for sure; null when they don't. */
export function sniffType(head: Uint8Array): FileType | null {
  if (starts(head, [0x25, 0x50, 0x44, 0x46])) return 'pdf';
  if (starts(head, [0x50, 0x4b, 0x03, 0x04]) || starts(head, [0x50, 0x4b, 0x05, 0x06]))
    return 'zip';
  if (ascii(head, 0, 5) === '{\\rtf') return 'rtf';
  if (starts(head, [0x89, 0x50, 0x4e, 0x47]) || starts(head, [0xff, 0xd8, 0xff])) return 'image';
  if (ascii(head, 0, 4) === 'GIF8') return 'image';
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') return 'image';
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WAVE') return 'audio';
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'AVI ') return 'video';
  if (ascii(head, 0, 3) === 'ID3' || ascii(head, 0, 4) === 'OggS' || ascii(head, 0, 4) === 'fLaC')
    return 'audio';
  if (ascii(head, 0, 6) === '#!AMR\n') return 'audio';
  if (ascii(head, 4, 4) === 'ftyp') {
    const brand = ascii(head, 8, 4);
    if (/^(heic|heix|mif1|avif)/.test(brand)) return 'image';
    if (/^(M4A |M4B )/.test(brand)) return 'audio';
    return 'video';
  }
  if (starts(head, [0x1a, 0x45, 0xdf, 0xa3])) return 'video';
  return null;
}

/** What an unreadable file is, in plain words ("a 7z archive"), from its first bytes and name. */
export function describeOther(head: Uint8Array, name: string, mime?: string): string {
  const ext = extOf(name);
  if (starts(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return 'a 7z archive';
  if (ascii(head, 0, 4) === 'Rar!') return 'a RAR archive';
  if (starts(head, [0x1f, 0x8b])) return 'a gzip-compressed file';
  if (starts(head, [0x42, 0x5a, 0x68])) return 'a bzip2-compressed file';
  if (ascii(head, 257, 5) === 'ustar') return 'a tar archive';
  if (ascii(head, 0, 15) === 'SQLite format 3') return 'an SQLite database';
  if (ascii(head, 0, 4) === '\x7fELF') return 'a program for Linux or Android';
  if (ascii(head, 0, 2) === 'MZ') return 'a Windows program';
  if (starts(head, [0xd0, 0xcf, 0x11, 0xe0])) {
    if (ext === 'doc') return 'an old Word document (.doc; save it as .docx and I can read it)';
    if (ext === 'ppt') return 'an old PowerPoint file (.ppt; save it as .pptx and I can read it)';
    if (ext === 'msg') return 'an Outlook message';
    return 'an old Microsoft Office file';
  }
  if (ascii(head, 0, 4) === '%!PS') return 'a PostScript file';
  if (ext === 'apk') return 'an Android app';
  if (ext === 'ipa') return 'an iPhone app';
  if (['stl', 'obj', 'glb', 'gltf', 'fbx', '3mf', 'ply'].includes(ext)) return 'a 3D model';
  if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) return 'a font';
  if (['psd', 'ai', 'sketch', 'fig', 'xcf'].includes(ext)) return 'a design file';
  if (['dwg', 'dxf'].includes(ext)) return 'a CAD drawing';
  if (ext === 'eml') return 'an email message';
  if (ext === 'pages' || ext === 'numbers' || ext === 'key') return 'an Apple iWork file';
  if (ext) return `a .${ext} file`;
  if (mime && mime !== 'application/octet-stream') return `a file of type ${mime}`;
  return 'a file of a kind I do not recognise';
}
