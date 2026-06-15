// Feature: 0015-airtable-data-layer, Property 10: Show name fallback format
// **Validates: Requirements 14.7**

import fc from 'fast-check';
import { toChartSource, SHOW_NAME_MAP } from '../../src/airtable/show-name-map.ts';

/** Arbitrary strings that are NOT keys in the SHOW_NAME_MAP */
const knownKeys = [...SHOW_NAME_MAP.keys()];

const arbUnknownShowName: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => !knownKeys.includes(s));

describe('Property 10: Show name fallback format', () => {
  it('for any string not in SHOW_NAME_MAP, toChartSource returns lowercased with non-alphanumeric replaced by underscores', () => {
    fc.assert(
      fc.property(arbUnknownShowName, (displayName) => {
        const result = toChartSource(displayName);
        const expected = displayName.toLowerCase().replace(/[^a-z0-9]/g, '_');
        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });
});
