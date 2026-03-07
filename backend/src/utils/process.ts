import { spawn } from "node:child_process";

export function parseArgs(template: string, replacements: Record<string, string>): string[] {
  const rendered = Object.entries(replacements).reduce((value, [key, replacement]) => {
    return value.replaceAll(`{${key}}`, replacement);
  }, template);

  const matches = rendered.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return matches.map((token) => token.replace(/^['"]|['"]$/g, ""));
}

type RunCommandOptions = {
  cwd?: string;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
};

function flushBufferedLines(buffer: string, onLine?: (line: string) => void): string {
  const normalized = buffer.replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  for (const line of lines.slice(0, -1)) {
    const trimmed = line.trim();
    if (trimmed && onLine) {
      onLine(trimmed);
    }
  }

  return lines.at(-1) ?? "";
}

export function runCommand(command: string, args: string[], options: RunCommandOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      stdoutBuffer = flushBufferedLines(stdoutBuffer, options.onStdoutLine);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      stderrBuffer += text;
      stderrBuffer = flushBufferedLines(stderrBuffer, options.onStderrLine);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      const stdoutTail = stdoutBuffer.trim();
      if (stdoutTail && options.onStdoutLine) {
        options.onStdoutLine(stdoutTail);
      }

      const stderrTail = stderrBuffer.trim();
      if (stderrTail && options.onStderrLine) {
        options.onStderrLine(stderrTail);
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}
