import { describe, expect, it } from 'vitest';

import { emailConfigSchema } from './pipeline-email-schema.js';
import { pipelineSchema } from './pipeline-schema.js';

const emailConfig = (extra: Record<string, unknown>) => ({
  reportOnly: false,
  digest: { slackChannelId: '' },
  ...extra,
});

let current: Record<string, unknown> = {};
const withEmailConfig = (extra: Record<string, unknown>): void => {
  current = emailConfig(extra);
};
const parsed = () => emailConfigSchema.parse(current);

describe('emailConfig.respond', () => {
  it('is optional', () => {
    withEmailConfig({});
    expect(parsed().respond).toBeUndefined();
  });

  it('reads a minimal config and applies defaults', () => {
    withEmailConfig({
      respond: {
        mailbox: 'aide@example.com',
        allowedSenders: ['jane@example.com'],
      },
    });
    expect(parsed().respond).toEqual({
      mailbox: 'aide@example.com',
      allowedSenders: ['jane@example.com'],
      maxRepliesPerThreadPerHour: 3,
      maxPerRun: 3,
      label: 'assistant-replied',
      slackMirror: false,
    });
  });

  it('lowercases and trims mailbox and allowedSenders', () => {
    withEmailConfig({
      respond: {
        mailbox: '  Aide@EXAMPLE.com  ',
        allowedSenders: [' Jane@EXAMPLE.com '],
      },
    });
    const respond = parsed().respond;
    expect(respond?.mailbox).toBe('aide@example.com');
    expect(respond?.allowedSenders).toEqual(['jane@example.com']);
  });

  it('reads an explicit dryRun, slackMirror and overridden caps/label', () => {
    withEmailConfig({
      respond: {
        mailbox: 'aide@example.com',
        allowedSenders: ['jane@example.com'],
        maxRepliesPerThreadPerHour: 1,
        maxPerRun: 5,
        label: 'custom-replied',
        dryRun: true,
        slackMirror: true,
      },
    });
    expect(parsed().respond).toEqual({
      mailbox: 'aide@example.com',
      allowedSenders: ['jane@example.com'],
      maxRepliesPerThreadPerHour: 1,
      maxPerRun: 5,
      label: 'custom-replied',
      dryRun: true,
      slackMirror: true,
    });
  });

  it('requires at least one allowed sender', () => {
    withEmailConfig({
      respond: { mailbox: 'aide@example.com', allowedSenders: [] },
    });
    expect(() => parsed()).toThrow();
  });

  it('rejects allowedSenders containing the mailbox', () => {
    withEmailConfig({
      respond: {
        mailbox: 'aide@example.com',
        allowedSenders: ['aide@example.com'],
      },
    });
    expect(() => parsed()).toThrow(
      /allowedSenders must not include the mailbox/,
    );
  });

  it('rejects an invalid mailbox address', () => {
    withEmailConfig({
      respond: { mailbox: 'not-an-email', allowedSenders: ['a@b.com'] },
    });
    expect(() => parsed()).toThrow();
  });

  it('rejects unknown keys', () => {
    withEmailConfig({
      respond: {
        mailbox: 'aide@example.com',
        allowedSenders: ['jane@example.com'],
        extra: true,
      },
    });
    expect(() => parsed()).toThrow();
  });
});

describe('pipeline: emailConfig.respond.mailbox', () => {
  const pipelineWith = (accounts: unknown[]) => ({
    accounts,
    buckets: { domains: [], priority: [] },
    refs: {},
    emailConfig: emailConfig({
      respond: {
        mailbox: 'aide@example.com',
        allowedSenders: ['jane@example.com'],
      },
    }),
  });
  const gmail = {
    email: 'Aide@example.com',
    type: 'gmail',
    emailPolling: true,
  };
  const imap = {
    email: 'aide@example.com',
    type: 'imap',
    emailPolling: true,
    imap: {
      host: 'imap.example.com',
      port: 993,
      tls: true,
      user: 'aide',
      password: { secretRef: 'aide' },
    },
  };

  it('accepts a gmail account', () => {
    expect(pipelineSchema.safeParse(pipelineWith([gmail])).success).toBe(true);
  });

  it('rejects an IMAP account: replies go out through gog', () => {
    const result = pipelineSchema.safeParse(pipelineWith([imap]));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(
      /is an imap account; email-respond needs a gmail/,
    );
  });

  it('rejects a mailbox that is not a configured account', () => {
    const result = pipelineSchema.safeParse(pipelineWith([]));
    expect(JSON.stringify(result.error?.issues)).toMatch(
      /must be a gmail account in accounts/,
    );
  });
});
