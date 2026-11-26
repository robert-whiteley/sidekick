/** The interpreter's pure logic: languages, prompts, reading the model's replies, routing. */
import {
  controlPrompt,
  INTERPRET_LANGUAGES,
  interpretLanguage,
  languageFromName,
  mayBeForSidekick,
  parseControlReply,
  parseTurnReply,
  partialTranslation,
  turnPrompt,
} from '@/engine/interpreter-logic';
import { relevantTools } from '@/engine/tools-logic';

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
  it('asks the model only when a word could point that way', () => {
    expect(mayBeForSidekick("OK Sidekick, that's enough")).toBe(true);
    expect(mayBeForSidekick('Please stop the car here')).toBe(true);
    expect(mayBeForSidekick('Can we use Dutch instead?')).toBe(true);
    expect(mayBeForSidekick('How much is it to the old harbour?')).toBe(false);
  });
  it('reads END / LANGUAGE / OTHER', () => {
    expect(parseControlReply('END')).toEqual({ kind: 'stop' });
    expect(parseControlReply('**END**')).toEqual({ kind: 'stop' });
    expect(parseControlReply('LANGUAGE: French.')).toEqual({ kind: 'switch', language: 'French' });
    expect(parseControlReply('LANGUAGE: <language>')).toBeNull();
    expect(parseControlReply('OTHER')).toBeNull();
    expect(parseControlReply('Hola')).toBeNull();
  });
  it('the prompt carries the line and the other language', () => {
    const p = controlPrompt(es, 'Please stop here');
    expect(p).toContain('"Please stop here"');
    expect(p).toContain('speaks Spanish');
  });
});

describe('routing', () => {
  const names = (q: string) => relevantTools(q).map((t) => t.name);
  it('offers the interpreter for a conversation', () => {
    expect(names('help me talk to this taxi driver in Spanish')).toContain('interpret');
    expect(names('be my interpreter, she speaks Japanese')).toContain('interpret');
    expect(names('translate for me and the driver, he speaks German')).toContain('interpret');
  });
  it('not for translating a text, or a question about a language', () => {
    expect(names("translate 'where is the station' into Spanish")).not.toContain('interpret');
    expect(names('what language do they speak in Brazil')).not.toContain('interpret');
  });
});
