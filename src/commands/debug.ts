import { SessionReader } from '../storage/session.js';
import { InteractiveDebugger } from '../debug/debugger.js';

interface DebugOptions {
  dir: string;
  step: string;
}

export async function debugCommand(sessionId: string, options: DebugOptions): Promise<void> {
  const reader = new SessionReader(options.dir, sessionId);
  const metadata = await reader.getMetadata();
  const records = await reader.getRecords();
  const startStep = parseInt(options.step, 10);

  console.log(`Session: ${sessionId}`);
  console.log(`Server:  ${metadata.serverName}`);
  console.log(`Calls:   ${metadata.toolCount}`);

  const debugger_ = new InteractiveDebugger(records, startStep);
  await debugger_.run();
}
