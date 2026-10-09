import { describe, expect, it } from 'vitest';

import { findSecretLiterals } from './secret-guard.js';

describe('findSecretLiterals', () => {
  it('finds a literal secret value by exact key name', () => {
    const findings = findSecretLiterals({
      integrations: { jira: { apiKey: '***' } },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.key).toBe('apiKey');
    expect(findings[0]?.path).toEqual(['integrations', 'jira', 'apiKey']);
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

  it('finds a literal IMAP password under pipeline.accounts (no exemptions)', () => {
    const findings = findSecretLiterals({
      pipeline: { accounts: [{ imap: { password: 'plain-text-password' } }] },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.path).toEqual([
      'pipeline',
      'accounts',
      0,
      'imap',
      'password',
    ]);
  });

  it('walks arrays and nested objects', () => {
    const findings = findSecretLiterals({
      list: [{ nested: { secret: 'value' } }, { other: 'fine' }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.path).toEqual(['list', 0, 'nested', 'secret']);
  });
});
