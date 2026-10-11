import { describe, expect, it } from 'vitest';

import { imapFlowConnector } from './connection.js';

describe('imapFlowConnector', () => {
  it('opens an unconnected imapflow client for the account', () => {
    const conn = imapFlowConnector(
      {
        host: 'imap.example.com',
        port: 993,
        tls: true,
        user: 'carol@example.com',
        password: { secretRef: 'carol' },
      },
      'pw',
    );
    expect(typeof conn.connect).toBe('function');
    expect(typeof conn.fetchAll).toBe('function');
  });
});
