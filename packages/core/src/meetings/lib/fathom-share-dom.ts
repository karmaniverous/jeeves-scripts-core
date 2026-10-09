/**
 * @module fathom-share-dom
 *
 * Pure helpers for structured DOM-based extraction of Fathom share page
 * content. Separates browser-context snapshot collection from the pure
 * extraction logic so the latter can be unit-tested without a browser.
 */

// ── Types ───────────────────────────────────────────────────────────

export interface FathomShareContent {
  summary: string;
  transcript: string;
}

export interface ButtonSnapshot {
  text: string;
  ancestorTexts: string[];
}

export interface HeadingSnapshot {
  text: string;
  followingTexts: string[];
}

export interface DomSnapshot {
  buttons: ButtonSnapshot[];
  headings: HeadingSnapshot[];
}

/**
 * Normalize an unknown browser snapshot into the expected array-backed shape.
 *
 * Runtime page-evaluate results can be malformed or unexpectedly empty; this
 * helper guarantees the pure extraction path always receives arrays.
 */
export function normalizeDomSnapshot(snapshot: unknown): DomSnapshot {
  const record =
    snapshot && typeof snapshot === 'object'
      ? (snapshot as Record<string, unknown>)
      : {};

  return {
    buttons: Array.isArray(record['buttons'])
      ? (record['buttons'] as ButtonSnapshot[])
      : [],
    headings: Array.isArray(record['headings'])
      ? (record['headings'] as HeadingSnapshot[])
      : [],
  };
}

// ── Browser-context collector (serialised JS) ───────────────────────

/**
 * JS function source evaluated inside `page.evaluate()`.
 *
 * Note: this is a function source string, so callers must wrap and invoke it
 * (for example `page.evaluate(`(${COLLECT_DOM_SNAPSHOT_JS})()`)`).
 *
 * Collects a lightweight snapshot of button and heading elements so the
 * extraction logic can run outside the browser context.
 */
export const COLLECT_DOM_SNAPSHOT_JS = `() => {
  function ancestorTexts(el) {
    var texts = [];
    var node = el.parentElement;
    while (node && node !== document.body) {
      var t = (node.innerText || '').trim();
      if (t.length > 0) texts.push(t);
      node = node.parentElement;
    }
    return texts;
  }

  function followingSiblingTexts(el) {
    var texts = [];
    var sib = el.nextElementSibling;
    while (sib) {
      var t = (sib.innerText || '').trim();
      if (t.length > 0) texts.push(t);
      sib = sib.nextElementSibling;
    }
    return texts;
  }

  var buttons = Array.from(document.querySelectorAll('button')).map(function(b) {
    return {
      text: (b.innerText || '').trim(),
      ancestorTexts: ancestorTexts(b)
    };
  });

  var headings = Array.from(
    document.querySelectorAll('h1, h2, h3, h4, h5, h6')
  ).map(function(h) {
    return {
      text: (h.innerText || '').trim(),
      followingTexts: followingSiblingTexts(h)
    };
  });

  return { buttons: buttons, headings: headings };
}`;

// ── Pure extraction ─────────────────────────────────────────────────

/**
 * Extract summary and transcript from a DOM snapshot.
 *
 * Strategy priority:
 *  1. Buttons — find a button whose text includes the label, then look
 *     for the first ancestor with substantial (>100 char) inner text.
 *     Strip lines that match any of the search labels.
 *  2. Headings — find a heading whose text exactly matches the label,
 *     then join its following-sibling texts.
 */
export function extractSectionsFromSnapshot(
  snapshot: DomSnapshot,
): FathomShareContent {
  const { buttons, headings } = snapshot;

  function findSection(labels: string[]): string {
    // Strategy 1: buttons with substantial ancestor text
    for (const label of labels) {
      const btn = buttons.find((b) =>
        b.text.toLowerCase().includes(label.toLowerCase()),
      );
      if (btn) {
        for (const ancestorText of btn.ancestorTexts) {
          if (ancestorText.length > 100) {
            const lines = ancestorText
              .split('\n')
              .filter(
                (l) =>
                  !labels.some((lb) =>
                    l.trim().toLowerCase().includes(lb.toLowerCase()),
                  ),
              );
            return lines.join('\n').trim();
          }
        }
      }
    }

    // Strategy 2: headings with following-sibling text
    for (const label of labels) {
      const heading = headings.find(
        (h) => h.text.toLowerCase() === label.toLowerCase(),
      );
      if (heading) {
        const text = heading.followingTexts.join('\n');
        if (text.trim()) return text.trim();
      }
    }

    return '';
  }

  return {
    summary: findSection(['Copy Summary', 'Summary']),
    transcript: findSection(['Copy Transcript', 'Transcript']),
  };
}
