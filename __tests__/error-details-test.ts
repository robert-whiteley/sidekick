/**
 * "Copy error details" (error-details-logic.ts): where, code, message, stack and versions, with no
 * personal content (quoted text, paths, links, emails and long numbers are taken out).
 */
import { errorDetails, scrub, type ErrorEnv } from '@/engine/error-details-logic';

const env: ErrorEnv = {
  app: '1.0.0',
  build: '5',
  os: 'iOS',
  osVersion: '26.1',
  device: 'iPhone14,4',
  ramMb: 3800,
  chatModel: 'gemma-4-E2B-it.litertlm',
  modelLoaded: true,
};

test('quoted text, paths, links, emails and long numbers are taken out', () => {
  const s = scrub(
    "[op-sqlite] SQL execution error: near 'Sam called about the flat': syntax error at /var/mobile/Containers/Data/Application/ABC/Library/Application Support/sidekick/data/memory.db, see https://example.com/x?q=1 or mail sam@example.com, call 07700900123",
  );
  expect(s).not.toMatch(/Sam called/);
  expect(s).not.toMatch(/Containers/);
  expect(s).not.toMatch(/example\.com/);
  expect(s).not.toMatch(/07700900123/);
  expect(s).toMatch(/SQL execution error/);
  expect(s).toMatch(/syntax error/);
});

test('the details name the place, code, message, stack and versions', () => {
  const e = Object.assign(new Error('file is not a database'), { code: 26 });
  e.stack =
    'Error: file is not a database\n    at openDb (index.bundle:12:345)\n    at getDb (index.bundle:1:2)';
  const d = errorDetails('answer', e, env, new Date('2026-11-27T10:00:00Z'));
  expect(d).toMatch(/^Sidekick error details$/m);
  expect(d).toMatch(/^Where: answer$/m);
  expect(d).toMatch(/^When: 2026-11-27T10:00:00.000Z$/m);
  expect(d).toMatch(/^Error: Error \(code 26\)$/m);
  expect(d).toMatch(/^Message: file is not a database$/m);
  expect(d).toMatch(/at openDb \(index\.bundle:12:345\)/);
  expect(d).toMatch(/^App: 1\.0\.0 \(5\)$/m);
  expect(d).toMatch(/^Phone: iPhone14,4, iOS 26\.1, 4 GB$/m);
  expect(d).toMatch(/^Chat model: gemma-4-E2B-it\.litertlm, loaded$/m);
});

test('a thrown string or object still gives details', () => {
  expect(errorDetails('screen', 'boom', env)).toMatch(/^Message: boom$/m);
  expect(errorDetails('screen', { code: 'answer-timeout' }, env)).toMatch(/code answer-timeout/);
});
