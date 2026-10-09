import { describe, expect, it } from 'vitest';

import { receiptConfigSchema } from './pipeline-email-schema.js';

describe('receiptConfigSchema', () => {
  it('accepts forwardEnabled', () => {
    expect(
      receiptConfigSchema.parse({
        forwardEnabled: true,
        sparkReceiptsForwardTo: 'r@example.com',
      }),
    ).toEqual({
      forwardEnabled: true,
      sparkReceiptsForwardTo: 'r@example.com',
    });
  });

  it('rejects the retired forwardJGS alias', () => {
    expect(() =>
      receiptConfigSchema.parse({
        forwardJGS: true,
        sparkReceiptsForwardTo: '',
      }),
    ).toThrow();
    expect(() =>
      receiptConfigSchema.parse({
        forwardEnabled: true,
        forwardJGS: true,
        sparkReceiptsForwardTo: '',
      }),
    ).toThrow(/forwardJGS/);
  });
});
