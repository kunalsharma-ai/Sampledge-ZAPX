# Protecting the repository on GitHub's free plan

SampCode lives in a private repository on GitHub's free plan, without GitHub Actions
([ADR 0009](../adr/0009-local-quality-gates.md)). Branch protection, rulesets, secret scanning and
push protection are not available for private repositories on that plan, so the protections below
are the ones that work today. Steps marked **you** need the repository owner; nobody else can do them.

## Already in the repository

- **Secret scanner** (`scripts/secret-scan.mjs`): AWS, Anthropic, OpenAI, Stripe, GitHub, Slack,
  Google, Twilio and SampCode keys, private keys, database addresses with passwords, and files that
  must never be committed (`.env`, `*.pem`, Terraform state and variables). It runs:
  - in `pnpm check`,
  - before every commit (staged changes) and every push (all tracked files), through the hooks in
    `.githooks/`. `pnpm install` turns them on; `pnpm hooks:install` does it by hand.
  - `node scripts/secret-scan.mjs --history` checks every line ever committed on the branches you fetched.
- **`.gitignore`** covers env files, keys, credentials and Terraform state.
- **Dependabot configuration** (`.github/dependabot.yml`) and **CODEOWNERS**.
- **`pnpm audit`** in `pnpm check` fails on high and critical advisories.

## Settings to turn on (you)

In the repository › **Settings › Code security** (free for private repositories):

1. **Dependabot alerts**: on. GitHub emails you when a dependency gets an advisory.
2. **Dependabot security updates**: on. GitHub opens pull requests that fix them. (They run no
   CI here; check them with `pnpm check` before merging, as for any pull request.)
3. **Private vulnerability reporting**: on, so researchers can report privately (see `SECURITY.md`).

In your account › **Settings › Password and authentication**:

4. **Two-factor authentication** with an authenticator app or a security key (not SMS). Whoever
   gets into your GitHub account gets the code.
5. Review **Sessions** and **SSH and GPG keys**; remove anything you do not recognise.

In your account › **Settings › Applications** and **Developer settings**:

6. Remove OAuth apps and GitHub Apps you no longer use; keep the Claude app limited to the
   repositories it needs.
7. Prefer fine-grained personal access tokens limited to one repository with an expiry date;
   delete classic tokens.

In the repository › **Settings › Collaborators**: give the least access that works (Write, not
Admin), and remove people who no longer work on SampCode.

## Without branch protection

- Work on branches and merge through pull requests only; never push to `main` directly.
- Run `pnpm check` before every merge (ADR 0009). The pre-push hook keeps secrets out even when you
  forget.
- If you upgrade to a paid plan later, add a ruleset on `main`: require a pull request, block force
  pushes and deletions, and turn on secret scanning with push protection.

## If a secret is committed

1. **Rotate it first** (create a new key at the provider, deploy it, revoke the old one). Removing it
   from git does not help once it has been pushed: assume it was copied.
2. Then remove it from history if you want (`git filter-repo`), and force-push only after everyone
   with a clone knows.
3. Record what happened in the audit notes.

Where each SampCode secret lives and how to rotate it is in [go-live.md](go-live.md) and
[../security.md](../security.md).
