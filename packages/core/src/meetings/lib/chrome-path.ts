/**
 * @module chrome-path
 *
 * The Chrome / Chromium executable puppeteer-core drives for the Fathom
 * share fetch (fathom-share-fetch): `PUPPETEER_EXECUTABLE_PATH`, else
 * `CHROME_PATH`, else a well-known install path for the platform.
 * Side effects: file-existence checks.
 */

import fs from 'node:fs';
import os from 'node:os';

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
