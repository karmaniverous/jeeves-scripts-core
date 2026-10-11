/**
 * @module fathom-share-fetch
 *
 * Fetch summary and transcript from a public Fathom share page.
 *
 * Uses puppeteer-core with the system Chrome executable to load
 * the share URL in a headless browser, then extracts content by
 * targeting visible UI controls (Summary, Transcript, Copy Summary,
 * Copy Transcript) — not brittle CSS selectors.
 *
 * Spec references: section 5, 7, 8.2.
 */

import fs from 'node:fs';
import os from 'node:os';

import { sleepAsync as sleep } from '@karmaniverous/jeeves';
import type { Page } from 'puppeteer-core';
import puppeteer from 'puppeteer-core';

import type { FathomShareContent } from './fathom-share-dom.js';
import {
  COLLECT_DOM_SNAPSHOT_JS,
  extractSectionsFromSnapshot,
  normalizeDomSnapshot,
} from './fathom-share-dom.js';

export type { FathomShareContent } from './fathom-share-dom.js';

// ── Constants ───────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;
const NAV_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;
const POLL_TIMEOUT_MS_TRANSCRIPT = 45_000;

// ── Chrome executable resolution ────────────────────────────────────

/** Well-known Chrome / Chromium paths per platform. */
const CHROME_CANDIDATES: Record<string, string[]> = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
};

/**
 * Resolve the Chrome executable path.
 *
 * Priority:
 *  1. `PUPPETEER_EXECUTABLE_PATH` env var
 *  2. `CHROME_PATH` env var
 *  3. Well-known paths for the current platform
 *
 * Throws with a helpful message when nothing is found.
 */
export function resolveChromePath(): string {
  const envPath =
    process.env.PUPPETEER_EXECUTABLE_PATH ?? process.env.CHROME_PATH;
  if (envPath) {
    if (!fs.existsSync(envPath)) {
      throw new Error(
        `Chrome executable not found at path from environment: ${envPath}`,
      );
    }
    return envPath;
  }

  const platform = os.platform();
  const candidates = CHROME_CANDIDATES[platform] ?? [];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    'Could not find a Chrome/Chromium executable. ' +
      'Set the PUPPETEER_EXECUTABLE_PATH environment variable to the path of your Chrome binary.',
  );
}

// ── Browser helpers ─────────────────────────────────────────────────

export function extractAfterMarker(bodyText: string, marker: string): string {
  const lines = bodyText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim());

  const idx = lines.findIndex(
    (l) => l.toLowerCase() === marker.trim().toLowerCase(),
  );
  if (idx === -1) return '';

  const after = lines
    .slice(idx + 1)
    .filter((l) => l.length > 0)
    .join('\n')
    .trim();

  return after;
}

/** The page calls the fetch makes (a puppeteer `Page` slice). */
export type SharePage = Pick<Page, 'goto' | 'evaluate'>;

/** A launched browser as the fetch uses it. */
export interface ShareBrowser {
  newPage: () => Promise<SharePage>;
  close: () => Promise<void>;
}

/** What {@link fetchFathomSharePage} launches and waits with. */
export interface ShareFetchBrowserDeps {
  /** Resolve the Chrome binary. */
  chromePath: () => string;
  /** Launch headless Chrome. */
  launch: (executablePath: string) => Promise<ShareBrowser>;
  /** Pause between polls. */
  sleep: (ms: number) => Promise<void>;
  /** Clock (ms), for the poll deadlines. */
  now: () => number;
}

const liveBrowser: ShareFetchBrowserDeps = {
  chromePath: resolveChromePath,
  launch: (executablePath) =>
    puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }),
  sleep,
  now: Date.now,
};

async function readBodyText(page: SharePage): Promise<string> {
  return page.evaluate(() => {
    const d = globalThis as unknown as {
      document?: { body?: { innerText?: unknown } };
    };
    const t = d.document?.body?.innerText;
    return typeof t === 'string' ? t : '';
  });
}

async function extractWithMarker(
  page: SharePage,
  marker: string,
  timeoutMs: number,
  deps: ShareFetchBrowserDeps,
): Promise<string> {
  const deadline = deps.now() + timeoutMs;
  while (deps.now() < deadline) {
    const bodyText = await readBodyText(page);
    const extracted = extractAfterMarker(bodyText, marker);
    if (extracted) return extracted;
    await deps.sleep(POLL_INTERVAL_MS);
  }
  return '';
}

/**
 * Collect a DOM snapshot and extract sections using the structured path.
 *
 * Polls until `deadline`, re-collecting the snapshot each iteration to
 * allow for lazy-loaded transcript content.
 */
async function extractWithDomSnapshot(
  page: SharePage,
  timeoutMs: number,
  deps: ShareFetchBrowserDeps,
): Promise<FathomShareContent> {
  const deadline = deps.now() + timeoutMs;
  let result: FathomShareContent = { summary: '', transcript: '' };
  while (deps.now() < deadline) {
    const snapshot = normalizeDomSnapshot(
      await page.evaluate(`(${COLLECT_DOM_SNAPSHOT_JS})()`),
    );
    result = extractSectionsFromSnapshot(snapshot);
    if (result.transcript) return result;
    await deps.sleep(POLL_INTERVAL_MS);
  }
  return result;
}

export function setFathomShareTab(
  shareUrl: string,
  tab: 'summary' | 'transcript',
): string {
  const url = new URL(shareUrl);
  url.searchParams.set('tab', tab);
  return url.toString();
}

export function stripLeadingTranscriptChrome(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  while (lines.length > 0) {
    const line = lines[0]?.trim() ?? '';
    if (!line || /^resume auto-scroll$/i.test(line)) {
      lines.shift();
      continue;
    }
    break;
  }

  return lines.join('\n').trim();
}

// ── Main entry point ────────────────────────────────────────────────

/**
 * Fetch summary and transcript from a public Fathom share page.
 *
 * Opens the URL in a headless browser, waits for content to render,
 * then extracts text from the Summary and Transcript sections.
 */
export async function fetchFathomSharePage(
  shareUrl: string,
  deps: ShareFetchBrowserDeps = liveBrowser,
): Promise<FathomShareContent> {
  const executablePath = deps.chromePath();

  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let browser: ShareBrowser | null = null;

    try {
      console.log(
        `[fathom-share] Opening ${shareUrl} (attempt ${String(attempt)}/${String(MAX_ATTEMPTS)})`,
      );

      browser = await deps.launch(executablePath);

      const page = await browser.newPage();

      const summaryUrl = setFathomShareTab(shareUrl, 'summary');
      await page.goto(summaryUrl, {
        waitUntil: 'networkidle2',
        timeout: NAV_TIMEOUT_MS,
      });

      let summary = await extractWithMarker(
        page,
        'Copy Summary',
        POLL_TIMEOUT_MS,
        deps,
      );
      if (!summary) {
        const domResult = await extractWithDomSnapshot(
          page,
          POLL_TIMEOUT_MS,
          deps,
        );
        summary = domResult.summary;
      }

      const transcriptUrl = setFathomShareTab(shareUrl, 'transcript');
      await page.goto(transcriptUrl, {
        waitUntil: 'networkidle2',
        timeout: NAV_TIMEOUT_MS,
      });

      let transcript = stripLeadingTranscriptChrome(
        await extractWithMarker(
          page,
          'Copy Transcript',
          POLL_TIMEOUT_MS_TRANSCRIPT,
          deps,
        ),
      );
      if (!transcript) {
        const domResult = await extractWithDomSnapshot(
          page,
          POLL_TIMEOUT_MS_TRANSCRIPT,
          deps,
        );
        transcript = stripLeadingTranscriptChrome(domResult.transcript);
      }

      if (!transcript) {
        throw new Error(
          'Transcript content empty after polling transcript tab URL',
        );
      }

      return { summary, transcript };
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      const msg = lastErr.message;

      const retryable =
        /Target closed|Session closed|No content extracted|transcript content empty/i.test(
          msg,
        );
      if (!retryable || attempt === MAX_ATTEMPTS) throw lastErr;

      console.log(`[fathom-share] Retrying: ${msg}`);
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {
          // best-effort
        }
      }
    }
  }

  throw lastErr ?? new Error('fetchFathomSharePage failed');
}
