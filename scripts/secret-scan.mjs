#!/usr/bin/env node
/**
 * Secret scanner (Milestone 20). GitHub's own secret scanning is not available for private
 * repositories on the free plan, so this runs on your machine instead: in `pnpm check`, and in the
 * pre-commit and pre-push hooks (`pnpm hooks:install`, done automatically by `pnpm install`).
 *
 *   node scripts/secret-scan.mjs            every tracked file
 *   node scripts/secret-scan.mjs --staged   only what is staged for the next commit (pre-commit)
 *   node scripts/secret-scan.mjs --history  every line ever added on any fetched branch
 *
 * A false positive can be allowed by putting `secret-scan:allow` on the same line. Never do that
 * for a real secret: rotate it instead (see docs/operations/github-security.md).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const RULES = [
  { name: 'AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'AWS secret access key', re: /aws_?secret_?access_?key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}\b/i },
  { name: 'Private key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI API key', re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/ },
  { name: 'Stripe live key', re: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}/ },
  { name: 'Stripe or SampCode webhook secret', re: /\bwhsec_[A-Za-z0-9+/_-]{32,}/ },
  { name: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/ },
  { name: 'Slack token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Twilio API key', re: /\bSK[0-9a-f]{32}\b/ },
  { name: 'SampCode API key', re: /\bzapx_[0-9a-f]{12}_[A-Za-z0-9_-]{32}\b/ },
  { name: 'SampCode SCIM token', re: /\bzapx_scim_[A-Za-z0-9_-]{32,}/ },
  {
    name: 'Database URL with a password',
    re: /\bpostgres(?:ql)?:\/\/[^:\s/'"]+:(?!zapx@|password@|postgres@|\$\{|\$)[^@\s'"]{6,}@(?!localhost|127\.0\.0\.1|postgres[:/])/,
  },
  {
    name: 'Secret assigned in a settings file',
    re: /^\s*(?:export\s+)?(?:JWT_SECRET|SECRETS_KEY|EDGE_SHARED_SECRET|[A-Z_]*(?:API_KEY|AUTH_TOKEN|SECRET_KEY|WEBHOOK_SECRET|PASSWORD))\s*=\s*['"]?(?!dev-only|change-?me|test|example|xxx|\$\{|<)[^\s'"#]{12,}/,
    files: /(^|\/)\.env(\.|$)|\.(sh|tfvars|ya?ml|toml|ini|conf)$/,
  },
];

/** Files that must never be committed, whatever they contain. */
const FORBIDDEN_FILES = [
  { name: 'Environment file', re: /(^|\/)\.env(\.(?!example$|sample$)[^/]+)?$/ },
  { name: 'Private key file', re: /\.(pem|key|p12|pfx|jks|keystore)$|(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/ },
  { name: 'Terraform state', re: /\.tfstate(\.backup)?$|(^|\/)\.terraform\// },
  { name: 'Terraform variables', re: /\.tfvars(\.json)?$/, allow: /(^|\/)example\.tfvars$/ },
  { name: 'Credentials file', re: /(^|\/)(credentials(\.json)?|\.npmrc|\.netrc|\.pgpass|service-account.*\.json)$/ },
];

const SKIP =
  /(^|\/)(node_modules|dist|\.next|coverage|\.turbo)\/|pnpm-lock\.yaml$|\.(png|jpe?g|gif|webp|ico|mp4|webm|mp3|ogg|wav|m4a|pdf|zip|gz|woff2?|xlsx|docx)$/i;
const ALLOW = 'secret-scan:allow';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30 });

function scanText(path, text, findings) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 5000 || line.includes(ALLOW)) continue;
    for (const r of RULES) {
      if (r.files && !r.files.test(path)) continue;
      if (r.re.test(line)) findings.push({ path, line: i + 1, rule: r.name });
    }
  }
}

function checkName(path, findings) {
  for (const f of FORBIDDEN_FILES) if (f.re.test(path) && !(f.allow && f.allow.test(path))) findings.push({ path, line: 0, rule: f.name });
}

function scanTree(staged) {
  const findings = [];
  const files = (staged ? git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z') : git('ls-files', '-z'))
    .split('\0')
    .filter(Boolean);
  for (const path of files) {
    checkName(path, findings);
    if (SKIP.test(path)) continue;
    let text;
    try {
      // Staged: exactly what will be committed. Otherwise: the file as it is on disk now.
      if (staged) text = git('show', `:${path}`);
      else if (existsSync(path)) text = readFileSync(path, 'utf8');
      else continue;
    } catch {
      continue;
    }
    if (text.includes('\0')) continue; // binary
    scanText(path, text, findings);
  }
  return findings;
}

function scanHistory() {
  const findings = [];
  const log = git('log', '--all', '-p', '--no-color', '--no-ext-diff', '-U0', '--format=commit %H');
  let commit = '';
  let path = '';
  for (const line of log.split('\n')) {
    if (line.startsWith('commit ')) commit = line.slice(7, 19);
    else if (line.startsWith('+++ b/')) {
      path = line.slice(6);
      const before = findings.length;
      checkName(path, findings);
      for (let i = before; i < findings.length; i++) findings[i].commit = commit;
    } else if (line.startsWith('+') && !line.startsWith('+++') && path && !SKIP.test(path)) {
      const before = findings.length;
      scanText(path, line.slice(1), findings);
      for (let i = before; i < findings.length; i++) findings[i].commit = commit;
    }
  }
  const seen = new Set();
  return findings.filter((f) => {
    const k = `${f.commit}:${f.path}:${f.rule}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

const mode = process.argv[2] ?? '';
if (!['', '--staged', '--history'].includes(mode)) {
  console.error('Usage: node scripts/secret-scan.mjs [--staged | --history]');
  process.exit(2);
}
const findings = mode === '--history' ? scanHistory() : scanTree(mode === '--staged');
if (findings.length === 0) {
  console.warn(
    `Secret scan: nothing found (${mode === '--history' ? 'all fetched history' : mode === '--staged' ? 'staged changes' : 'tracked files'}).`,
  );
  process.exit(0);
}
console.error('\nSecret scan found possible secrets. Remove them, and rotate any real secret: it may already be copied.\n');
for (const f of findings) console.error(`  ${f.commit ? `${f.commit} ` : ''}${f.path}${f.line ? `:${f.line}` : ''}  ${f.rule}`);
console.error(`\nA false positive can be allowed with "${ALLOW}" on the same line.\n`);
process.exit(1);
