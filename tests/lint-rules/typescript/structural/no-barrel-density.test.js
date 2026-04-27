'use strict';

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/structural/no-barrel-density.js');

ruleTester.run('no-barrel-density', rule, {
  valid: [
    {
      code: 'export { foo } from "./foo";\nexport { bar } from "./bar";',
      filename: 'src/index.ts',
    },
    {
      code: 'export { foo } from "./foo";\nexport { bar } from "./bar";\nexport { baz } from "./baz";\nexport function init() { return 42; }',
      filename: 'src/index.ts',
    },
    {
      code: 'export { a } from "./a";\nexport { b } from "./b";\nexport { c } from "./c";',
      filename: 'src/service.ts',
    },
    {
      code: 'export { a } from "./a";\nexport { b } from "./b";\nexport { c } from "./c";\nexport { d } from "./d";\nconst local = 1;',
      filename: 'src/index.js',
    },
  ],
  invalid: [
    {
      code: 'export { a } from "./a";\nexport { b } from "./b";\nexport { c } from "./c";',
      filename: 'src/index.ts',
      errors: [{ messageId: 'barrelDensity' }],
    },
    {
      code: 'export { a } from "./a";\nexport { b } from "./b";\nexport { c } from "./c";\nexport { d } from "./d";\nexport type { E } from "./e";\nconst local = 1;',
      filename: 'src/index.tsx',
      errors: [{ messageId: 'barrelDensity' }],
    },
    {
      code: 'export * from "./a";\nexport * from "./b";\nexport * from "./c";\nexport * from "./d";',
      filename: 'src/index.mjs',
      errors: [{ messageId: 'barrelDensity' }],
    },
  ],
});
