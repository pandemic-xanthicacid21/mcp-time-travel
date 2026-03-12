import chalk from 'chalk';
import readline from 'node:readline';
import type { ToolCallRecord, RecordEntry } from '../storage/types.js';

export class InteractiveDebugger {
  private toolCalls: ToolCallRecord[];
  private position: number;
  private rl: readline.Interface;

  constructor(records: RecordEntry[], startStep: number) {
    this.toolCalls = records.filter((r): r is ToolCallRecord => r.type === 'tool_call');
    this.position = Math.max(0, startStep - 1);
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async run(): Promise<void> {
    console.log(chalk.bold(`\nmcp-replay debugger`));
    console.log(chalk.dim(`${this.toolCalls.length} tool calls recorded\n`));
    this.showHelp();

    if (this.toolCalls.length > 0) {
      this.showCurrentCall();
    }

    await this.promptLoop();
  }

  private showCurrentCall(): void {
    if (this.position >= this.toolCalls.length) {
      console.log(chalk.yellow('\n  End of recording reached.\n'));
      return;
    }

    const call = this.toolCalls[this.position];
    console.log(chalk.bold.cyan(`\n  [${call.seq}/${this.toolCalls.length}] ${call.tool}`));
    console.log(chalk.dim(`  Timestamp: ${call.timestamp}`));
    console.log(chalk.dim(`  Latency:   ${call.latency_ms}ms`));
    if (call.is_error) console.log(chalk.red(`  ERROR`));
    console.log(chalk.green(`  Input:`));
    console.log(indent(JSON.stringify(call.input, null, 2)));
    console.log(chalk.yellow(`  Output:`));
    console.log(indent(JSON.stringify(call.output, null, 2)));
    console.log();
  }

  private showHelp(): void {
    console.log(chalk.dim('  Commands:'));
    console.log(chalk.dim('    n / next       → Next tool call'));
    console.log(chalk.dim('    p / prev       → Previous tool call'));
    console.log(chalk.dim('    l / list       → List all tool calls'));
    console.log(chalk.dim('    g <n>          → Go to step N'));
    console.log(chalk.dim('    m / modify     → Modify input (shows JSON, opens editor prompt)'));
    console.log(chalk.dim('    o / override   → Override output'));
    console.log(chalk.dim('    h / help       → Show this help'));
    console.log(chalk.dim('    q / quit       → Exit debugger'));
    console.log();
  }

  private async promptLoop(): Promise<void> {
    return new Promise<void>((resolve) => {
      const ask = () => {
        this.rl.question(chalk.bold('> '), async (input) => {
          const cmd = input.trim().toLowerCase();
          const parts = cmd.split(/\s+/);

          switch (parts[0]) {
            case 'n':
            case 'next':
              if (this.position < this.toolCalls.length - 1) {
                this.position++;
                this.showCurrentCall();
              } else {
                console.log(chalk.yellow('  Already at end of recording.'));
              }
              break;

            case 'p':
            case 'prev':
              if (this.position > 0) {
                this.position--;
                this.showCurrentCall();
              } else {
                console.log(chalk.yellow('  Already at start of recording.'));
              }
              break;

            case 'l':
            case 'list':
              this.listAll();
              break;

            case 'g':
            case 'goto': {
              const n = parseInt(parts[1], 10);
              if (isNaN(n) || n < 1 || n > this.toolCalls.length) {
                console.log(chalk.red(`  Invalid step. Use 1-${this.toolCalls.length}`));
              } else {
                this.position = n - 1;
                this.showCurrentCall();
              }
              break;
            }

            case 'm':
            case 'modify':
              await this.modifyInput();
              break;

            case 'o':
            case 'override':
              await this.overrideOutput();
              break;

            case 'h':
            case 'help':
              this.showHelp();
              break;

            case 'q':
            case 'quit':
              console.log(chalk.dim('  Exiting debugger.'));
              this.rl.close();
              resolve();
              return;

            default:
              if (parts[0]) {
                console.log(chalk.red(`  Unknown command: ${cmd}. Type "h" for help.`));
              }
          }
          ask();
        });
      };
      ask();
    });
  }

  private listAll(): void {
    console.log();
    for (let i = 0; i < this.toolCalls.length; i++) {
      const call = this.toolCalls[i];
      const marker = i === this.position ? chalk.cyan('→') : ' ';
      const error = call.is_error ? chalk.red(' ERROR') : '';
      console.log(
        `  ${marker} [${call.seq}] ${chalk.bold(call.tool)} ${chalk.dim(`${call.latency_ms}ms`)}${error}`
      );
    }
    console.log();
  }

  private async modifyInput(): Promise<void> {
    const call = this.toolCalls[this.position];
    console.log(chalk.dim('  Current input:'));
    console.log(indent(JSON.stringify(call.input, null, 2)));
    console.log(chalk.dim('  Enter new JSON input (single line):'));

    return new Promise<void>((resolve) => {
      this.rl.question(chalk.bold('  json> '), (line) => {
        try {
          const newInput = JSON.parse(line);
          this.toolCalls[this.position] = { ...call, input: newInput };
          console.log(chalk.green('  Input modified.'));
        } catch {
          console.log(chalk.red('  Invalid JSON. Input not modified.'));
        }
        resolve();
      });
    });
  }

  private async overrideOutput(): Promise<void> {
    const call = this.toolCalls[this.position];
    console.log(chalk.dim('  Current output:'));
    console.log(indent(JSON.stringify(call.output, null, 2)));
    console.log(chalk.dim('  Enter new JSON output (single line):'));

    return new Promise<void>((resolve) => {
      this.rl.question(chalk.bold('  json> '), (line) => {
        try {
          const newOutput = JSON.parse(line);
          this.toolCalls[this.position] = { ...call, output: newOutput };
          console.log(chalk.green('  Output overridden.'));
        } catch {
          console.log(chalk.red('  Invalid JSON. Output not modified.'));
        }
        resolve();
      });
    });
  }
}

function indent(text: string): string {
  return text.split('\n').map(line => '    ' + line).join('\n');
}
