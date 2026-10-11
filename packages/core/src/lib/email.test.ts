import { describe, expect, it } from 'vitest';

import {
  extractAttachments,
  extractTextFromPayload,
  headerValue,
} from './email.js';

describe('headerValue', () => {
  it('finds header case-insensitively', () => {
    const headers = [
      { name: 'Subject', value: 'Hello' },
      { name: 'From', value: 'test@example.com' },
    ];
    expect(headerValue(headers, 'subject')).toBe('Hello');
    expect(headerValue(headers, 'FROM')).toBe('test@example.com');
  });

  it('returns empty string for missing header', () => {
    const headers = [{ name: 'Subject', value: 'Hello' }];
    expect(headerValue(headers, 'To')).toBe('');
  });

  it('returns empty string for undefined headers', () => {
    expect(headerValue(undefined, 'Subject')).toBe('');
  });
});

describe('extractTextFromPayload', () => {
  it('extracts plain text body', () => {
    const payload = {
      mimeType: 'text/plain',
      body: { data: Buffer.from('Hello world').toString('base64') },
    };
    const result = extractTextFromPayload(payload);
    expect(result.text).toBe('Hello world');
    expect(result.html).toBe('');
  });

  it('extracts HTML body', () => {
    const payload = {
      mimeType: 'text/html',
      body: { data: Buffer.from('<p>Hello</p>').toString('base64') },
    };
    const result = extractTextFromPayload(payload);
    expect(result.html).toBe('<p>Hello</p>');
    expect(result.text).toBe('');
  });

  it('extracts from multipart payload', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: Buffer.from('Plain text').toString('base64') },
        },
        {
          mimeType: 'text/html',
          body: { data: Buffer.from('<p>HTML</p>').toString('base64') },
        },
      ],
    };
    const result = extractTextFromPayload(payload);
    expect(result.text).toBe('Plain text');
    expect(result.html).toBe('<p>HTML</p>');
  });

  it('handles Gmail URL-safe base64', () => {
    // Gmail uses URL-safe base64: - instead of +, _ instead of /
    const text = 'Hello+World/Test=';
    const encoded = Buffer.from(text)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const payload = {
      mimeType: 'text/plain',
      body: { data: encoded },
    };
    const result = extractTextFromPayload(payload);
    expect(result.text).toBe(text);
  });

  it('returns empty for null payload', () => {
    const result = extractTextFromPayload(null);
    expect(result).toEqual({ text: '', html: '' });
  });
});

describe('extractAttachments', () => {
  it('extracts attachment metadata', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: 'dGVzdA==' },
        },
        {
          filename: 'report.pdf',
          mimeType: 'application/pdf',
          body: { size: 1024, attachmentId: 'att-123' },
        },
      ],
    };
    const result = extractAttachments(payload);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      attachmentId: 'att-123',
    });
  });

  it('returns empty for no attachments', () => {
    const payload = {
      mimeType: 'text/plain',
      body: { data: 'dGVzdA==' },
    };
    expect(extractAttachments(payload)).toEqual([]);
  });

  it('handles null payload', () => {
    expect(extractAttachments(null)).toEqual([]);
  });
});
