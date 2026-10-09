import { describe, expect, it } from 'vitest';

import { placeholder } from './index';

describe('placeholder', () => {
  it('returns the package placeholder string', () => {
    expect(placeholder()).toBe('jeeves-scripts-core');
  });
});
