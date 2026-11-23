import { spawnSync } from "node:child_process";

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("Run this check through npm run audit:production.");
  process.exit(1);
}

const audit = spawnSync(process.execPath, [npmCli, "audit", "--omit=dev", "--audit-level=high", "--json"], {
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
  timeout: 120_000,
});

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error("npm audit did not return a valid report.", audit.error?.message || audit.stderr);
  process.exit(1);
}

const counts = report?.metadata?.vulnerabilities;
if (report?.error || report?.auditReportVersion !== 2 || !report?.vulnerabilities ||
    ![counts?.high, counts?.critical, counts?.moderate].every(n => Number.isSafeInteger(n) && n >= 0)) {
  console.error("npm audit failed or returned an incomplete report.", report?.error || audit.stderr);
  process.exit(1);
}

console.log(`Production dependency audit: ${counts.critical} critical, ${counts.high} high, ${counts.moderate} moderate.`);
for (const [name, finding] of Object.entries(report.vulnerabilities)) {
  if (["critical", "high"].includes(finding.severity)) {
    console.error(`- ${name}: ${finding.severity}`);
    process.exitCode = 1;
  }
}
if (audit.status !== 0 || audit.error || audit.signal || counts.high || counts.critical) process.exitCode = 1;
