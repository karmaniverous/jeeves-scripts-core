import { describe, expect, it } from 'vitest';

import { sampleJobGreeting } from './index';

describe('sampleJobGreeting', () => {
  it('greets using the consumed core package', () => {
    expect(sampleJobGreeting()).toBe('hello from jeeves-scripts-core');
  });
});
