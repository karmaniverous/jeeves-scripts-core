/**
 * Tests for channel detection from session transcripts.
 */

import { describe, expect, it } from 'vitest';

import { detectChannel } from './channel-mapper.js';

describe('detectChannel', () => {
  it('detects heartbeat sessions', () => {
    const lines = [
      '{"type":"session","id":"abc"}',
      '{"type":"message","message":{"role":"user","content":"Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats."}}',
    ];
    const result = detectChannel(lines);
    expect(result.key).toBe('heartbeat');
    expect(result.name).toBe('Heartbeat');
  });

  it('detects subagent sessions', () => {
    const lines = [
      '{"type":"session","id":"abc"}',
      '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"[Subagent Context] depth 1/1\\n\\n[Subagent Task]: Build feature"}]}}',
    ];
    const result = detectChannel(lines);
    expect(result.key).toBe('subagent');
    expect(result.name).toBe('Subagent');
  });

  it('detects meta-synthesis subagents', () => {
    const lines = [
      '{"type":"session","id":"abc"}',
      '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"[Subagent Context]\\n[Subagent Task]: jeeves-meta-synthesis-cycle"}]}}',
    ];
    const result = detectChannel(lines);
    expect(result.key).toBe('meta-synthesis');
    expect(result.name).toBe('Meta Synthesis');
  });

  it('detects meta architect phase from H1 header', () => {
    const lines = [
      '{"type":"session","id":"abc"}',
      '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"[Subagent Context]\\n[Subagent Task]: # jeeves-meta \u00b7 ARCHITECT \u00b7 j:/domains/contacts/john"}]}}',
    ];
    const result = detectChannel(lines);
    expect(result.key).toBe('meta-architect');
    expect(result.name).toBe('Meta Architect');
  });

  it('detects meta builder phase from H1 header', () => {
    const lines = [
      '{"type":"session","id":"abc"}',
      '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"[Subagent Context]\\n[Subagent Task]: # jeeves-meta \u00b7 BUILDER \u00b7 j:/domains/contacts/john"}]}}',
    ];
    const result = detectChannel(lines);
    expect(result.key).toBe('meta-builder');
    expect(result.name).toBe('Meta Builder');
  });

  it('detects meta critic phase from H1 header', () => {
    const lines = [
      '{"type":"session","id":"abc"}',
      '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"[Subagent Context]\\n[Subagent Task]: # jeeves-meta \u00b7 CRITIC \u00b7 j:/domains/contacts/john"}]}}',
    ];
    const result = detectChannel(lines);
    expect(result.key).toBe('meta-critic');
    expect(result.name).toBe('Meta Critic');
  });

  it('detects meta phase from session label pattern', () => {
    const lines = [
      '{"type":"session","id":"abc"}',
      '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"[Subagent Context] meta-architect-abc123\\n[Subagent Task]: synthesize entity"}]}}',
    ];
    const result = detectChannel(lines);
    expect(result.key).toBe('meta-architect');
    expect(result.name).toBe('Meta Architect');
  });

  it('detects meta phase from internal completion event', () => {
    const lines = [
      '{"type":"session","id":"abc"}',
      '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"[Internal task completion event] task: jeeves-meta-synthesis-abc # jeeves-meta \u00b7 BUILDER \u00b7 path"}]}}',
    ];
    const result = detectChannel(lines);
    expect(result.key).toBe('meta-builder');
    expect(result.name).toBe('Meta Builder');
  });

  it('detects Slack DMs', () => {
    const lines = [
      '{"type":"session","id":"abc"}',
      '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"System: [2026-03-05] Slack DM from Alice Example: hello"}]}}',
    ];
    const result = detectChannel(lines);
    expect(result.key).toBe('slack:dm:alice-example');
    expect(result.name).toBe('DM: Alice Example');
  });

  it('detects Slack channel from message pattern', () => {
    const lines = [
      '{"type":"session","id":"abc"}',
      '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"System: Slack message in #project-jeeves-runner from Jason: test"}]}}',
    ];
    const result = detectChannel(lines);
    expect(result.key).toBe('slack:channel:#project-jeeves-runner');
    expect(result.name).toBe('#project-jeeves-runner');
  });

  it('detects Slack channel from conversation_label metadata', () => {
    const lines = [
      '{"type":"session","id":"abc"}',
      '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"Conversation info:\\n```json\\n{\\"conversation_label\\": \\"#project-test\\"}\\n```"}]}}',
    ];
    const result = detectChannel(lines);
    expect(result.key).toBe('slack:channel:#project-test');
    expect(result.name).toBe('#project-test');
  });

  it('detects channel ID from channel: pattern', () => {
    const lines = [
      '{"type":"session","id":"abc"}',
      '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"[slack message id: 123 channel: C000EXAMPLE1]"}]}}',
    ];
    const result = detectChannel(lines);
    expect(result.key).toBe('slack:channel:C000EXAMPLE1');
  });

  it('detects Slack DM from custom_message runtime context', () => {
    const lines = [
      '{"type":"session","id":"abc"}',
      '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"Let\'s fix the attribution first"}]}}',
      '{"type":"custom_message","customType":"openclaw.runtime-context","content":"System (untrusted): [2026-05-05 04:16:14 UTC] Slack DM from Alice Example: Let\'s fix the attribution first\\n\\nConversation info (untrusted metadata):\\n```json\\n{\\n  \\"chat_id\\": \\"user:U000EXAMPLE\\",\\n  \\"sender\\": \\"Alice Example\\"\\n}\\n```"}',
    ];
    const result = detectChannel(lines);
    expect(result.key).toBe('slack:dm:alice-example');
    expect(result.name).toBe('DM: Alice Example');
  });

  it('detects Slack channel from custom_message runtime context', () => {
    const lines = [
      '{"type":"session","id":"abc"}',
      '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"test message"}]}}',
      '{"type":"custom_message","customType":"openclaw.runtime-context","content":"System (untrusted): [2026-05-05 04:03:34 UTC] Slack message in #project-example from Alice Example: test\\n\\nConversation info (untrusted metadata):\\n```json\\n{\\n  \\"conversation_label\\": \\"#project-example\\"\\n}\\n```"}',
    ];
    const result = detectChannel(lines);
    expect(result.key).toBe('slack:channel:#project-example');
    expect(result.name).toBe('#project-example');
  });

  it('returns unknown for unrecognized sessions', () => {
    const lines = [
      '{"type":"session","id":"abc"}',
      '{"type":"message","message":{"role":"user","content":"just some text"}}',
    ];
    const result = detectChannel(lines);
    expect(result.key).toBe('unknown');
    expect(result.name).toBe('Unknown');
  });

  it('handles edited message pattern', () => {
    const lines = [
      '{"type":"session","id":"abc"}',
      '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"System: Slack message edited in #project-test."}]}}',
    ];
    const result = detectChannel(lines);
    expect(result.key).toBe('slack:channel:#project-test');
  });

  it('detects meta-synthesis from Linux-style temp paths', () => {
    const lines = [
      '{"type":"session","id":"abc"}',
      '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"[Subagent Context]\\n[Subagent Task]: Write to /tmp/jeeves-meta/output-abc123.json"}]}}',
    ];
    const result = detectChannel(lines);
    expect(result.key).toBe('meta-synthesis');
    expect(result.name).toBe('Meta Synthesis');
  });
});
