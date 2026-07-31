import { spawnSync } from "node:child_process";

const allowedHighPackages = new Set([
  "bigint-buffer",
  "@solana/buffer-layout-utils",
  "@solana/spl-token",
]);

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("npm_execpath is unavailable. Run this check through npm run audit:production.");
  process.exit(1);
}

const audit = spawnSync(process.execPath, [npmCli, "audit", "--omit=dev", "--json"], {
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});

if (!audit.stdout) {
  console.error(audit.stderr || "npm audit did not return a report.");
  process.exit(1);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error("npm audit returned invalid JSON.");
  process.exit(1);
}

const vulnerabilities = Object.entries(report.vulnerabilities ?? {});
const blocking = vulnerabilities.filter(([name, vulnerability]) => {
  if (vulnerability.severity === "critical") return true;
  return vulnerability.severity === "high" && !allowedHighPackages.has(name);
});

if (blocking.length > 0) {
  console.error("Production dependency audit found unapproved high or critical vulnerabilities:");
  for (const [name, vulnerability] of blocking) {
    console.error(`- ${name}: ${vulnerability.severity}`);
  }
  process.exit(1);
}

const allowedFindings = vulnerabilities.filter(
  ([name, vulnerability]) => vulnerability.severity === "high" && allowedHighPackages.has(name),
);
console.log(
  `Production dependency audit passed with ${allowedFindings.length} documented Solana high-severity dependency entries and no critical findings.`,
);
