import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const CLI_PATH = path.join(PROJECT_ROOT, 'dist', 'cli.js');
const PACKAGE_JSON_PATH = path.join(PROJECT_ROOT, 'package.json');

describe('CLI integration', () => {
  it('reports the package version', async () => {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as { version: string };
    const { stdout } = await execFileAsync('node', [CLI_PATH, '--version']);

    expect(stdout.trim()).toBe(pkg.version);
  });
});
