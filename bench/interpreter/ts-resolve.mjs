// Lets plain Node run the app's .ts files, whose imports leave out the extension:
//   node --import ./bench/interpreter/ts-resolve.mjs bench/interpreter/routing.ts
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  try {
    return await next(spec, ctx);
  } catch (e) {
    if (spec.startsWith('.') && !/\\.[a-z]+$/.test(spec)) return next(spec + '.ts', ctx);
    throw e;
  }
}`),
);
