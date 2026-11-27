/** The interpreter's pure logic: languages, prompts, reading the model's replies, routing. */
import {
  endCheckPrompt,
  endConfirmed,
  INTERPRET_LANGUAGES,
  interpretLanguage,
  languageFromName,
  parseControlReply,
  parseTurnReply,
  partialTranslation,
  turnPrompt,
} from '@/engine/interpreter-logic';
import { catalogSystem, DECIDE_TOOLS, lockSafe } from '@/engine/decide-logic';
import { toolByName } from '@/engine/tools-logic';

const en = interpretLanguage('en')!;
const es = interpretLanguage('es')!;
const ja = interpretLanguage('ja')!;

describe('languages', () => {
  it('names the model gives map to a language we offer', () => {
    expect(languageFromName('Spanish')?.code).toBe('es');
    expect(languageFromName(' spanish. ')?.code).toBe('es');
    expect(languageFromName('es')?.code).toBe('es');
    expect(languageFromName('Español')?.code).toBe('es');
    expect(languageFromName('français')?.code).toBe('fr');
    expect(languageFromName('Brazilian Portuguese')?.code).toBe('pt');
    expect(languageFromName('Mandarin')?.code).toBe('zh');
    expect(languageFromName('Klingon')).toBeNull();
    expect(languageFromName('')).toBeNull();
  });
  it('European languages use Parakeet v3, the others Whisper', () => {
    expect(es.stt).toBe('parakeet-v3');
    expect(ja.stt).toBe('whisper');
    expect(new Set(INTERPRET_LANGUAGES.map((l) => l.code)).size).toBe(INTERPRET_LANGUAGES.length);
  });
});

describe('turn prompt', () => {
  it('translates the right way for each side, with recent turns as context', () => {
    const p = turnPrompt(en, es, 'them', '¿Adónde vamos?', [
      { side: 'me', heard: 'Hello', said: 'Hola', at: 0 },
    ]);
    expect(p).toContain('Translate from Spanish into English');
    expect(p).toContain('Owner: Hello → Hola');
    expect(p).toContain('Other person (Spanish): ¿Adónde vamos?');
    expect(turnPrompt(en, es, 'me', 'Hi')).toContain('Translate from English into Spanish');
  });
  it('keeps only the last two turns, and skips ones not translated', () => {
    const turns = [1, 2, 3].map((n) => ({
      side: 'me' as const,
      heard: `t${n}`,
      said: `s${n}`,
      at: n,
    }));
    const p = turnPrompt(en, es, 'me', 'x', [
      ...turns,
      { side: 'them', heard: 'y', said: null, at: 4 },
    ]);
    expect(p).not.toContain('t1');
    expect(p).toContain('t2 → s2');
    expect(p).toContain('t3 → s3');
  });
});

describe('reading the translation', () => {
  it('takes the SAY line and drops notes and quotes', () => {
    expect(parseTurnReply('SAY: "Hola, ¿qué tal?"\nNote: informal')).toBe('Hola, ¿qué tal?');
    expect(parseTurnReply('**SAY:** Bonjour')).toBe('Bonjour');
    expect(parseTurnReply('Guten Tag')).toBe('Guten Tag');
    expect(parseTurnReply('')).toBeNull();
  });
  it('skips an echo of what was heard before the translation', () => {
    const heard = "That's the end of the conversation, thank you.";
    expect(parseTurnReply(`${heard}\nEs el final de la conversación, gracias.`, heard)).toBe(
      'Es el final de la conversación, gracias.',
    );
  });
  it('keeps a lone echo (a name or "Taxi!" is the same in both languages)', () => {
    expect(parseTurnReply('Taxi!', 'Taxi!')).toBe('Taxi!');
  });
  it('shows the translation while it streams', () => {
    expect(partialTranslation('SA')).toBeNull();
    expect(partialTranslation('SAY: "Hola, qu')).toBe('Hola, qu');
  });
});

describe('is the owner talking to Sidekick?', () => {
  it("the owner's turn asks who it is said to in the same reply; the other side's doesn't", () => {
    expect(turnPrompt(en, es, 'me', 'Please stop here')).toContain(
      'SIDEKICK: <NO, END or LANGUAGE',
    );
    expect(turnPrompt(en, es, 'them', 'Pare aquí')).not.toContain('SIDEKICK:');
  });
  it('reads END / LANGUAGE / NO from the SIDEKICK line', () => {
    expect(parseControlReply('SIDEKICK: END\nSAY: Ya está')).toEqual({ kind: 'stop' });
    expect(parseControlReply('**SIDEKICK:** **END**')).toEqual({ kind: 'stop' });
    expect(parseControlReply('SIDEKICK: LANGUAGE: French.\nSAY: x')).toEqual({
      kind: 'switch',
      language: 'French',
    });
    expect(parseControlReply('SIDEKICK: LANGUAGE: <language>')).toBeNull();
    expect(parseControlReply('SIDEKICK: NO\nSAY: Pare aquí')).toBeNull();
  });
  it('an unreadable or missing SIDEKICK line translates as normal', () => {
    expect(parseControlReply('SAY: Hola')).toBeNull();
    expect(parseControlReply('SIDEKICK: NO\nSAY: Okay Sidekick: stop')).toBeNull();
    expect(parseControlReply('Hola')).toBeNull();
    expect(parseControlReply('SIDEKICK: ???\nSAY: Hola')).toBeNull();
    expect(parseTurnReply('SIDEKICK: NO\nSAY: Pare aquí, por favor.')).toBe(
      'Pare aquí, por favor.',
    );
    expect(parseTurnReply('SIDEKICK: NO\nPare aquí.')).toBe('Pare aquí.');
  });
  it("doesn't show a translation of a line meant for Sidekick while it streams", () => {
    expect(partialTranslation('SIDEKICK: END\nSAY: Ya pue')).toBeNull();
    expect(partialTranslation('SIDEKICK: NO\nSAY: Pare aq')).toBe('Pare aq');
  });
  it('an END is looked at once more; only END there ends the session', () => {
    const p = endCheckPrompt(es, "Thanks, that's all for today.");
    expect(p).toContain('"Thanks, that\'s all for today."');
    expect(p).toContain('speaks Spanish');
    expect(endConfirmed('END')).toBe(true);
    expect(endConfirmed('**END**')).toBe(true);
    expect(endConfirmed('OTHER')).toBe(false);
    expect(endConfirmed('LANGUAGE: French')).toBe(false);
    expect(endConfirmed('')).toBe(false);
  });
});

describe('routing', () => {
  it('the translate tool can start the interpreter (talk), chosen by the model', () => {
    const t = toolByName('translate')!;
    expect(t.args.talk?.type).toBe('boolean');
    expect(DECIDE_TOOLS).toContain(t);
    expect(catalogSystem()).toContain('or interpret a spoken conversation');
    expect(lockSafe('translate', { to: 'Spanish', talk: true })).toBe(false);
  });
});
