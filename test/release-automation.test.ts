import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const PACKAGE_JSON_PATH = path.join(PROJECT_ROOT, 'package.json');
const CHANGESET_CONFIG_PATH = path.join(PROJECT_ROOT, '.changeset', 'config.json');
const CHANGESET_README_PATH = path.join(PROJECT_ROOT, '.changeset', 'README.md');
const README_PATH = path.join(PROJECT_ROOT, 'README.md');
const RELEASE_WORKFLOW_PATH = path.join(PROJECT_ROOT, '.github', 'workflows', 'release.yml');
const CHANGESET_CHECK_WORKFLOW_PATH = path.join(PROJECT_ROOT, '.github', 'workflows', 'changeset-required.yml');
const LEGACY_PUBLISH_WORKFLOW_PATH = path.join(PROJECT_ROOT, '.github', 'workflows', 'publish.yml');

describe('release automation configuration', () => {
  it('adds Changesets scripts and dependency', () => {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(pkg.scripts?.changeset).toBe('changeset');
    expect(pkg.scripts?.['version-packages']).toBe('changeset version');
    expect(pkg.scripts?.release).toBe('changeset publish');
    expect(pkg.devDependencies?.['@changesets/cli']).toBeTruthy();
  });

  it('stores Changesets config in the repo', () => {
    expect(fs.existsSync(CHANGESET_CONFIG_PATH)).toBe(true);
    expect(fs.existsSync(CHANGESET_README_PATH)).toBe(true);

    const config = JSON.parse(fs.readFileSync(CHANGESET_CONFIG_PATH, 'utf-8')) as {
      baseBranch?: string;
      access?: string;
      changelog?: unknown;
    };

    expect(config.baseBranch).toBe('main');
    expect(config.access).toBe('public');
    expect(config.changelog).toBeTruthy();
  });

  it('replaces the manual publish workflow with push-driven release automation', () => {
    expect(fs.existsSync(RELEASE_WORKFLOW_PATH)).toBe(true);
    expect(fs.existsSync(LEGACY_PUBLISH_WORKFLOW_PATH)).toBe(false);

    const workflow = fs.readFileSync(RELEASE_WORKFLOW_PATH, 'utf-8');
    expect(workflow).toMatch(/on:\s+push:\s+branches:\s+- main/s);
    expect(workflow).toMatch(/contents:\s+write/s);
    expect(workflow).toMatch(/pull-requests:\s+write/s);
    expect(workflow).toMatch(/id-token:\s+write/s);
    expect(workflow).toContain('changesets/action@v1');
    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('npm run check');
    expect(workflow).toContain('npm run version-packages');
    expect(workflow).toContain('npm run release');
    expect(workflow).toContain('NPM_CONFIG_PROVENANCE');
  });

  it('adds a PR changeset requirement check', () => {
    expect(fs.existsSync(CHANGESET_CHECK_WORKFLOW_PATH)).toBe(true);

    const workflow = fs.readFileSync(CHANGESET_CHECK_WORKFLOW_PATH, 'utf-8');
    expect(workflow).toMatch(/on:\s+pull_request:/s);
    expect(workflow).toContain('changeset-release/');
    expect(workflow).toContain('scripts/changeset-required.mjs');
    expect(workflow).toContain('needs a changeset');
  });

  it('documents the automated release flow in the README', () => {
    const readme = fs.readFileSync(README_PATH, 'utf-8');

    expect(readme).toContain('## Releasing');
    expect(readme).toContain('Changeset');
    expect(readme).toContain('release PR');
    expect(readme).toContain('GitHub Release');
    expect(readme).toContain('npm');
  });
});
