import { describe, expect, it } from 'vitest';

import { findSecretLiterals } from './secret-guard.js';

describe('findSecretLiterals', () => {
  it('finds a literal secret value by exact key name', () => {
    const findings = findSecretLiterals({
      integrations: { jira: { apiKey: 'literal-value' } },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].key).toBe('apiKey');
    expect(findings[0].path).toEqual(['integrations', 'jira', 'apiKey']);
  });

  it('ignores keys that merely contain a denylisted substring', () => {
    const findings = findSecretLiterals({
      calendar: { tokenFile: 'gog-token-jscroft.json' },
      jira: { apiTokenPath: '/creds/token.txt' },
    });
    expect(findings).toEqual([]);
  });

  it('ignores an empty string value', () => {
    const findings = findSecretLiterals({ password: '' });
    expect(findings).toEqual([]);
  });

  it('ignores a secretRef object', () => {
    const findings = findSecretLiterals({
      password: { secretRef: 'carol' },
    });
    expect(findings).toEqual([]);
  });

  it('exempts pipeline.accounts (own deprecated-literal handling)', () => {
    const findings = findSecretLiterals({
      pipeline: {
        accounts: [{ imap: { password: 'plain-text-password' } }],
      },
    });
    expect(findings).toEqual([]);
  });

  it('still scans siblings of an exempt subtree', () => {
    const findings = findSecretLiterals({
      pipeline: {
        accounts: [{ imap: { password: 'ignored-here' } }],
      },
      integrations: { notion: { apiKey: 'literal-value' } },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toEqual(['integrations', 'notion', 'apiKey']);
  });

  it('walks arrays and nested objects', () => {
    const findings = findSecretLiterals({
      list: [{ nested: { secret: 'value' } }, { other: 'fine' }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toEqual(['list', 0, 'nested', 'secret']);
  });
});
