import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Reviewed surfaces and removal conditions are recorded in SECURITY.md.
const exceptions = new Map([
  [
    "bigint-buffer",
    { version: "1.1.5", advisories: ["GHSA-3gc7-fjrx-p6mg"], via: [] },
  ],
  [
    "@solana/buffer-layout-utils",
    {
      version: "0.3.0",
      advisories: [],
      via: ["bigint-buffer", "@solana/web3.js"],
    },
  ],
  [
    "@solana/spl-token",
    {
      version: "0.4.15",
      advisories: [],
      via: [
        "@solana/buffer-layout-utils",
        "@solana/spl-token-group",
        "@solana/spl-token-metadata",
        "@solana/web3.js",
      ],
    },
  ],
  [
    "image-size",
    {
      version: "1.2.1",
      advisories: ["GHSA-5p2g-fcmc-qvqq", "GHSA-w3rx-r6r6-pgpr"],
      via: [],
    },
  ],
]);
const lock = JSON.parse(
  readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
);

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error(
    "npm_execpath is unavailable. Run this check through npm run audit:production.",
  );
  process.exit(1);
}

const audit = spawnSync(
  process.execPath,
  [npmCli, "audit", "--omit=dev", "--json"],
  {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
  },
);

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

if (
  audit.error ||
  audit.signal ||
  ![0, 1].includes(audit.status) ||
  report.error ||
  report.auditReportVersion !== 2 ||
  !report.vulnerabilities ||
  !report.metadata?.vulnerabilities
) {
  console.error(
    "npm audit failed or returned an incomplete report.",
    audit.error?.message || report.error || audit.stderr,
  );
  process.exit(1);
}

function isReviewedException(name, vulnerability) {
  const exception = exceptions.get(name);
  if (
    !exception ||
    vulnerability.severity !== "high" ||
    !vulnerability.nodes?.length ||
    !vulnerability.via?.length
  )
    return false;
  // A new version, install location, advisory, or dependency edge requires review.
  if (
    !vulnerability.nodes.every(
      (node) =>
        node === `node_modules/${name}` &&
        lock.packages?.[node]?.version === exception.version,
    )
  )
    return false;
  return vulnerability.via.every((via) =>
    typeof via === "string"
      ? exception.via.includes(via)
      : via.severity === "high" &&
        exception.advisories.some(
          (id) => via.url === `https://github.com/advisories/${id}`,
        ),
  );
}

const vulnerabilities = Object.entries(report.vulnerabilities);
const blocking = vulnerabilities.filter(([name, vulnerability]) => {
  if (vulnerability.severity === "critical") return true;
  return (
    vulnerability.severity === "high" &&
    !isReviewedException(name, vulnerability)
  );
});

if (blocking.length > 0) {
  console.error(
    "Production dependency audit found unapproved high or critical vulnerabilities:",
  );
  for (const [name, vulnerability] of blocking) {
    console.error(`- ${name}: ${vulnerability.severity}`);
  }
  process.exit(1);
}

const allowedFindings = vulnerabilities.filter(([name, vulnerability]) =>
  isReviewedException(name, vulnerability),
);
console.log(
  `Production dependency audit passed: ${report.metadata.vulnerabilities.critical} critical, ${allowedFindings.length} narrowly reviewed high entries, ${report.metadata.vulnerabilities.moderate} moderate. See SECURITY.md.`,
);
for (const [name] of allowedFindings)
  console.log(`- Reviewed exception: ${name}@${exceptions.get(name).version}`);
