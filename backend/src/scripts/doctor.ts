import { config } from "../config.js";
import { getReadinessReport } from "../services/readinessService.js";

async function main(): Promise<void> {
  const report = await getReadinessReport();

  console.log(`Project root: ${config.projectRoot}`);
  console.log(`Backend root: ${config.backendRoot}`);
  console.log(`Runtime class: ${report.processing.runtimeClass ?? "unknown"}`);
  console.log(`Expected backend: ${report.processing.expectedBackend ?? "unknown"}`);
  console.log(`Translation path: ${report.processing.translationPath ?? "pending"}`);
  console.log("");

  for (const result of report.checks) {
    console.log(`[${result.status.toUpperCase()}] ${result.label}: ${result.detail}`);
  }

  if (report.status === "fail") {
    process.exitCode = 1;
  }
}

void main();
