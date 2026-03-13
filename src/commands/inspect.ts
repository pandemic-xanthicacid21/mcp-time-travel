import chalk from 'chalk';
import { SessionReader } from '../storage/session.js';

interface InspectOptions {
  dir: string;
}

export async function inspectCommand(sessionId: string, options: InspectOptions): Promise<void> {
  const reader = new SessionReader(options.dir, sessionId);
  const metadata = await reader.getMetadata();
  const toolCalls = await reader.getToolCalls();

  // Compute duration
  const duration = metadata.startTime && metadata.endTime
    ? formatDuration(new Date(metadata.endTime).getTime() - new Date(metadata.startTime).getTime())
    : 'unknown';

  // Count errors
  const errorCount = toolCalls.filter(tc => tc.is_error).length;

  // Header
  console.log();
  console.log(chalk.bold('Session Summary'));
  console.log(chalk.dim('─'.repeat(43)));
  console.log(`${chalk.dim('ID:')}          ${metadata.id}`);
  console.log(`${chalk.dim('Server:')}      ${metadata.serverName}`);
  console.log(`${chalk.dim('Transport:')}   ${metadata.transport ?? 'stdio'}`);
  console.log(`${chalk.dim('Duration:')}    ${duration}`);
  console.log(`${chalk.dim('Tool calls:')}  ${toolCalls.length}`);
  console.log(`${chalk.dim('Errors:')}      ${errorCount > 0 ? chalk.red(String(errorCount)) : '0'}`);

  // Top tools bar chart
  if (toolCalls.length > 0) {
    const freq = new Map<string, number>();
    for (const tc of toolCalls) {
      freq.set(tc.tool, (freq.get(tc.tool) ?? 0) + 1);
    }

    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    const maxNameLen = Math.max(...sorted.map(([name]) => name.length));
    const barWidth = 20;

    console.log();
    console.log(chalk.bold('Top tools:'));
    for (const [name, count] of sorted) {
      const pct = count / toolCalls.length;
      const filled = Math.round(pct * barWidth);
      const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
      const label = name.padEnd(maxNameLen);
      console.log(`  ${label}  ${String(count).padStart(2)} calls  ${chalk.cyan(bar)}  ${Math.round(pct * 100)}%`);
    }
  }

  // Timeline
  if (toolCalls.length > 0) {
    console.log();
    console.log(chalk.bold('Timeline:'));
    for (const tc of toolCalls) {
      const seq = `#${tc.seq}`.padStart(4);
      const name = tc.tool.padEnd(16);
      const latency = `${tc.latency_ms}ms`.padStart(6);
      const errorMark = tc.is_error ? chalk.red(' ERR') : '';
      console.log(`  ${chalk.dim(seq)}  ${name} ${latency}${errorMark}`);
    }
  }

  console.log();
}

function formatDuration(ms: number): string {
  if (ms < 0) return 'unknown';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
