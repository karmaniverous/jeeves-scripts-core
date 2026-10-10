import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findFiles, needsConversion, writeMdFile } from './convert-utils.js';

describe('convert-utils', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('findFiles', () => {
    it('finds files with matching extension', () => {
      fs.writeFileSync(path.join(tmpDir, 'a.pdf'), '');
      fs.writeFileSync(path.join(tmpDir, 'b.pdf'), '');
      fs.writeFileSync(path.join(tmpDir, 'c.txt'), '');

      const results = findFiles([tmpDir], '.pdf');
      expect(results).toHaveLength(2);
      expect(results.every((f) => f.endsWith('.pdf'))).toBe(true);
    });

    it('recurses into subdirectories', () => {
      const sub = path.join(tmpDir, 'sub');
      fs.mkdirSync(sub);
      fs.writeFileSync(path.join(sub, 'deep.docx'), '');

      const results = findFiles([tmpDir], '.docx');
      expect(results).toHaveLength(1);
      expect(results[0]).toContain('deep.docx');
    });

    it('handles multiple root directories', () => {
      const dir1 = path.join(tmpDir, 'd1');
      const dir2 = path.join(tmpDir, 'd2');
      fs.mkdirSync(dir1);
      fs.mkdirSync(dir2);
      fs.writeFileSync(path.join(dir1, 'a.pdf'), '');
      fs.writeFileSync(path.join(dir2, 'b.pdf'), '');

      const results = findFiles([dir1, dir2], '.pdf');
      expect(results).toHaveLength(2);
    });

    it('returns empty array for non-existent directory', () => {
      const results = findFiles([path.join(tmpDir, 'nope')], '.pdf');
      expect(results).toEqual([]);
    });

    it('returns empty array when no files match', () => {
      fs.writeFileSync(path.join(tmpDir, 'file.txt'), '');
      const results = findFiles([tmpDir], '.pdf');
      expect(results).toEqual([]);
    });
  });

  describe('needsConversion', () => {
    it('returns true when md file does not exist', () => {
      const src = path.join(tmpDir, 'doc.pdf');
      fs.writeFileSync(src, 'content');

      expect(needsConversion(src, path.join(tmpDir, 'doc.md'))).toBe(true);
    });

    it('returns true when source is newer than md', () => {
      const src = path.join(tmpDir, 'doc.pdf');
      const md = path.join(tmpDir, 'doc.md');
      fs.writeFileSync(md, 'old');
      fs.writeFileSync(src, 'new content');
      // Force source to be newer via explicit timestamp
      const future = new Date(Date.now() + 10_000);
      fs.utimesSync(src, future, future);

      expect(needsConversion(src, md)).toBe(true);
    });

    it('returns false when md is newer than source', () => {
      const src = path.join(tmpDir, 'doc.pdf');
      const md = path.join(tmpDir, 'doc.md');
      fs.writeFileSync(src, 'content');
      fs.writeFileSync(md, 'converted');
      // Force md to be newer via explicit timestamp
      const future = new Date(Date.now() + 10_000);
      fs.utimesSync(md, future, future);

      expect(needsConversion(src, md)).toBe(false);
    });
  });

  describe('writeMdFile', () => {
    it('writes file with YAML frontmatter and content', () => {
      const mdPath = path.join(tmpDir, 'output.md');
      writeMdFile(mdPath, { title: 'Test Doc', pages: 5 }, 'Body text here');

      const content = fs.readFileSync(mdPath, 'utf8');
      expect(content).toContain('---');
      expect(content).toContain('title: Test Doc');
      expect(content).toContain('pages: 5');
      expect(content).toContain('Body text here');
    });

    it('formats frontmatter correctly with delimiters', () => {
      const mdPath = path.join(tmpDir, 'out.md');
      writeMdFile(mdPath, { key: 'value' }, 'content');

      const content = fs.readFileSync(mdPath, 'utf8');
      expect(content.startsWith('---\n')).toBe(true);
      expect(content).toMatch(/---\nkey: value\n---\n\ncontent\n/);
    });

    it('handles empty frontmatter', () => {
      const mdPath = path.join(tmpDir, 'empty.md');
      writeMdFile(mdPath, {}, 'body');

      const content = fs.readFileSync(mdPath, 'utf8');
      expect(content).toBe('---\n\n---\n\nbody\n');
    });
  });
});
