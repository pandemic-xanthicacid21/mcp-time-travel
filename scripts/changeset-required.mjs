#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CHANGESET_DIR = '.changeset/';
const CHANGESET_README = '.changeset/README.md';
const RELEASE_BRANCH_PREFIX = 'changeset-release/';
const RELEASABLE_PATHS = [
  /^src\//,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^tsconfig\.json$/,
];

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function hasChangesetFile(paths) {
  return paths
    .map(normalizePath)
    .some((filePath) => {
      return (
        filePath.startsWith(CHANGESET_DIR) &&
        filePath.endsWith('.md') &&
        filePath !== CHANGESET_README
      );
    });
}

export function needsChangesetForPaths(paths) {
  return paths
    .map(normalizePath)
    .some((filePath) => RELEASABLE_PATHS.some((pattern) => pattern.test(filePath)));
}

function readChangedPathsFromGit() {
  const baseSha = process.env.BASE_SHA;
  const headSha = process.env.HEAD_SHA;
  const range = baseSha && headSha ? `${baseSha}...${headSha}` : 'origin/main...HEAD';
  const output = execFileSync('git', ['diff', '--name-only', range], {
    encoding: 'utf8',
  });

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function run() {
  if ((process.env.GITHUB_HEAD_REF ?? '').startsWith(RELEASE_BRANCH_PREFIX)) {
    console.log('Skipping changeset requirement for automated release PR.');
    return;
  }

  const paths = process.argv.slice(2).length > 0 ? process.argv.slice(2) : readChangedPathsFromGit();

  if (!needsChangesetForPaths(paths)) {
    console.log('No changeset required for this pull request.');
    return;
  }

  if (hasChangesetFile(paths)) {
    console.log('Changeset found for releasable changes.');
    return;
  }

  console.error(
    'This pull request changes published package behavior and needs a changeset. Run `npm run changeset` and commit the generated file.',
  );
  process.exitCode = 1;
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entrypoint === fileURLToPath(import.meta.url)) {
  run();
}
