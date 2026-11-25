// eslint-disable-next-line @typescript-eslint/no-require-imports
const { addFlavours } = require('../plugins/with-flavours.js');

it('adds play and full flavours once, before defaultConfig', () => {
  const gradle =
    "android {\n    namespace 'x'\n    defaultConfig {\n        applicationId 'x'\n    }\n}\n";
  const out = addFlavours(gradle);
  expect(out).toMatch(
    /productFlavors \{\s+play \{ dimension "distribution" \}\s+full \{ dimension "distribution" \}/,
  );
  expect(out.indexOf('productFlavors')).toBeLessThan(out.indexOf('defaultConfig'));
  expect(addFlavours(out)).toBe(out);
});
