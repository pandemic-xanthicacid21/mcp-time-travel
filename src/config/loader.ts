import fs from 'node:fs';
import type { McpServerConfig } from '../storage/types.js';

interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

export function loadServerConfig(configPath: string, serverName: string): McpServerConfig {
  const raw = fs.readFileSync(configPath, 'utf-8');
  const config: McpConfigFile = JSON.parse(raw);

  if (!config.mcpServers || !config.mcpServers[serverName]) {
    const available = config.mcpServers ? Object.keys(config.mcpServers).join(', ') : 'none';
    throw new Error(
      `Server "${serverName}" not found in config. Available servers: ${available}`
    );
  }

  return config.mcpServers[serverName];
}
