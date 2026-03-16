import { describe, expect, it } from 'vitest';
import {
  hasChangesetFile,
  needsChangesetForPaths,
} from '../scripts/changeset-required.mjs';

describe('changeset requirement policy', () => {
  it('requires a changeset for shipped source changes', () => {
    expect(needsChangesetForPaths(['src/commands/replay.ts'])).toBe(true);
  });

  it('requires a changeset for package metadata changes', () => {
    expect(needsChangesetForPaths(['package.json'])).toBe(true);
    expect(needsChangesetForPaths(['package-lock.json'])).toBe(true);
  });

  it('does not require a changeset for docs, tests, or README-only changes', () => {
    expect(needsChangesetForPaths(['README.md'])).toBe(false);
    expect(needsChangesetForPaths(['docs/PROMO.md'])).toBe(false);
    expect(needsChangesetForPaths(['test/integration/record-replay.test.ts'])).toBe(false);
  });

  it('detects changeset files separately from releasable paths', () => {
    expect(hasChangesetFile(['.changeset/friendly-note.md'])).toBe(true);
    expect(hasChangesetFile(['src/commands/replay.ts'])).toBe(false);
  });
});
