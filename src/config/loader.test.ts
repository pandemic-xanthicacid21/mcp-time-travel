import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadServerConfig } from './loader.js';

describe('loadServerConfig', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-config-test-'));
    configPath = path.join(tmpDir, 'mcp.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('loads a server config by name', () => {
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        'my-server': { command: 'node', args: ['server.js'] },
        'other-server': { command: 'python', args: ['server.py'] },
      },
    }));

    const config = loadServerConfig(configPath, 'my-server');
    expect(config.command).toBe('node');
    expect(config.args).toEqual(['server.js']);
  });

  it('throws if server name not found', () => {
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        'my-server': { command: 'node' },
      },
    }));

    expect(() => loadServerConfig(configPath, 'missing')).toThrow(/not found/i);
  });

  it('throws if config file does not exist', () => {
    expect(() => loadServerConfig('/nonexistent/path.json', 'foo')).toThrow();
  });

  it('loads env from server config', () => {
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        'env-server': { command: 'node', env: { API_KEY: 'secret' } },
      },
    }));

    const config = loadServerConfig(configPath, 'env-server');
    expect(config.env).toEqual({ API_KEY: 'secret' });
  });
});
