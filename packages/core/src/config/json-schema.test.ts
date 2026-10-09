import { describe, expect, it } from 'vitest';

import { generateJsonSchema } from './json-schema.js';

describe('generateJsonSchema', () => {
  it('generates a JSON Schema object with the top-level config properties', () => {
    const schema = generateJsonSchema();
    expect(schema).toHaveProperty('properties');
    const properties = schema.properties as Record<string, unknown>;
    expect(properties).toHaveProperty('instance');
    expect(properties).toHaveProperty('paths');
    expect(properties).toHaveProperty('integrations');
    expect(properties).toHaveProperty('pipeline');
    expect(properties).toHaveProperty('siloRouting');
    expect(properties).toHaveProperty('jobs');
    expect(properties).toHaveProperty('extensions');
  });
});
