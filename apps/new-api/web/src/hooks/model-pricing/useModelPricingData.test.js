/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const hookFile = fileURLToPath(
  new URL('./useModelPricingData.jsx', import.meta.url),
);

test('model pricing hook has no unresolved runtime identifiers', async () => {
  const eslint = new ESLint({
    cache: false,
    overrideConfig: {
      rules: {
        'no-undef': 'error',
      },
    },
  });
  const [ruleProbe] = await eslint.lintText(
    'const unresolved = intentionallyMissingIdentifier;\n',
    { filePath: hookFile },
  );
  assert.ok(
    ruleProbe.messages.some((message) => message.ruleId === 'no-undef'),
    'the regression test must enable the no-undef rule',
  );

  const [result] = await eslint.lintFiles([hookFile]);
  const unresolvedIdentifiers = result.messages.filter(
    (message) => message.ruleId === 'no-undef',
  );

  assert.deepEqual(unresolvedIdentifiers, []);
});
