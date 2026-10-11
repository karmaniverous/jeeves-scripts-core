/**
 * @module notion-browser-extract
 *
 * Extract meeting content (Summary, Notes, Transcript) from a Notion public
 * page using the Gateway browser tool.
 */

import { gatewayInvoke, sleep, unwrapResult } from './gateway-client.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface ExtractedContent {
  h2: string;
  fullText: string;
  tabs: {
    summary: string;
    notes: string;
    transcript: string;
  };
}

// ── Constants ──────────────────────────────────────────────────────────

const BROWSER_PROFILE = 'openclaw';
const MAX_ATTEMPTS = 5;

// ── Browser helpers ────────────────────────────────────────────────────

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

async function clickTab(targetId: string, name: string): Promise<void> {
  const raw = await gatewayInvoke('browser', {
    action: 'act',
    profile: BROWSER_PROFILE,
    targetId,
    request: {
      kind: 'evaluate',
      fn: `() => {
        const el = Array.from(document.querySelectorAll('[role="tab"]')).find(e => (e.innerText||'').trim() === ${JSON.stringify(name)});
        if (!el) return { ok: false, reason: 'tab not found' };
        el.click();
        return { ok: true };
      }`,
    },
  });

  const result = unwrapResult(raw).result as
    { ok: boolean; reason?: string } | undefined;
  if (result && !result.ok) {
    throw new Error(result.reason ?? 'tab click failed');
  }

  await sleep(800);
}

async function extractActiveTabText(targetId: string): Promise<string> {
  const raw = await gatewayInvoke('browser', {
    action: 'act',
    profile: BROWSER_PROFILE,
    targetId,
    request: {
      kind: 'evaluate',
      fn: `() => {
        const t = (document.body && document.body.innerText) ? document.body.innerText : '';
        const marker = 'Summary\\nNotes\\nTranscript\\n';
        const i = t.indexOf(marker);
        const after = i >= 0 ? t.slice(i + marker.length) : t;
        const cutMarkers = ['\\n40 citations', '\\nWas this summary helpful?'];
        let end = after.length;
        for (const m of cutMarkers) {
          const j = after.indexOf(m);
          if (j >= 0 && j < end) end = j;
        }
        return after.slice(0, end).trim();
      }`,
    },
  });
  return asString(unwrapResult(raw).result);
}

// ── Main extraction ────────────────────────────────────────────────────

export async function extractFromPublicPage(
  publicUrl: string,
): Promise<ExtractedContent> {
  await gatewayInvoke('browser', {
    action: 'start',
    profile: BROWSER_PROFILE,
  });

  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let targetId: string | null = null;

    try {
      console.log(
        `[notion-inbox] browser open (attempt ${String(attempt)}/${String(MAX_ATTEMPTS)})`,
      );
      const openedRaw = await gatewayInvoke('browser', {
        action: 'open',
        profile: BROWSER_PROFILE,
        targetUrl: publicUrl,
      });

      const opened = unwrapResult(openedRaw);
      targetId = typeof opened.targetId === 'string' ? opened.targetId : null;
      if (!targetId) throw new Error('Browser open did not return targetId');

      console.log(
        `[notion-inbox] initial load wait (attempt ${String(attempt)}/${String(MAX_ATTEMPTS)}) targetId=${targetId}`,
      );
      await sleep(4000);

      // Title hint
      const h2Raw = await gatewayInvoke('browser', {
        action: 'act',
        profile: BROWSER_PROFILE,
        targetId,
        request: {
          kind: 'evaluate',
          fn: `() => (Array.from(document.querySelectorAll('h2')).map(e=>e.innerText.trim()).find(Boolean) || '')`,
        },
      });
      const h2 = asString(unwrapResult(h2Raw).result);

      const tabs: ExtractedContent['tabs'] = {
        summary: '',
        notes: '',
        transcript: '',
      };

      for (const tabName of ['Summary', 'Notes', 'Transcript'] as const) {
        const key = tabName.toLowerCase() as keyof ExtractedContent['tabs'];
        try {
          await clickTab(targetId, tabName);
          tabs[key] = await extractActiveTabText(targetId);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!/tab not found/i.test(msg)) throw err;
          tabs[key] = '';
        }
      }

      // Fallback: full text
      const fullTextRaw = await gatewayInvoke('browser', {
        action: 'act',
        profile: BROWSER_PROFILE,
        targetId,
        request: {
          kind: 'evaluate',
          fn: `() => ((document.body && document.body.innerText) ? document.body.innerText.trim() : '')`,
        },
      });
      const fullText = asString(unwrapResult(fullTextRaw).result);

      return { h2, fullText, tabs };
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      const msg = lastErr.message;

      const retryable =
        /tab not found|Target closed|Session closed|not return targetId/i.test(
          msg,
        );
      if (!retryable || attempt === MAX_ATTEMPTS) throw lastErr;
    } finally {
      if (targetId) {
        try {
          await gatewayInvoke('browser', {
            action: 'close',
            profile: BROWSER_PROFILE,
            targetId,
          });
        } catch {
          // best-effort
        }
      }
    }
  }

  throw lastErr ?? new Error('extractFromPublicPage failed');
}
