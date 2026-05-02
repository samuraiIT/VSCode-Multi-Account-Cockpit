# sample-codex-coauthor

[![Verify attribution bundle](https://github.com/sigridjineth/sample-codex-coauthor/actions/workflows/verify-attribution-bundle.yml/badge.svg?branch=main)](https://github.com/sigridjineth/sample-codex-coauthor/actions/workflows/verify-attribution-bundle.yml)

Sample repository showing how to make Git commits include a GitHub-recognized Codex co-author trailer automatically.

## What this demonstrates

- automatic `Co-authored-by:` trailer injection via `prepare-commit-msg`
- a repo-local setup script
- a Codex default that you can extend with other AI or human co-authors

## Codex trailer

This repo defaults to:

```text
Co-authored-by: codex <codex@openai.com>
```

The current basis for that address is the OpenAI Codex GitHub discussion below, where a March 17, 2026 comment reports that this trailer shows the Codex avatar on GitHub:

- https://github.com/openai/codex/discussions/2807

## Quick start

```bash
./scripts/setup-codex-attribution.sh
```

Then make a commit normally:

```bash
git add .
git commit -m "Add feature"
```

The hook appends the trailer automatically.

## Copy/paste into your repo

If you just want the fastest adoption path, run this from this sample repository:

```bash
./scripts/bootstrap-into-target-repo.sh /path/to/your-repo
```

Then, inside your target repo, future commits will automatically append:

```text
Co-authored-by: codex <codex@openai.com>
```

To add another co-author later:

```bash
git config --local --add ai.coauthor "Name <email@example.com>"
```

## Reuse this in another repository

To copy the hook, setup script, and Codex skills into another existing Git repository:

```bash
./scripts/bootstrap-into-target-repo.sh /path/to/other-repo
```

If the target already has different versions of any managed files, the bootstrap script stops before changing anything. Use `--force` if you intentionally want to overwrite them:

```bash
./scripts/bootstrap-into-target-repo.sh --force /path/to/other-repo
```

After copying the files, the bootstrap script automatically runs the target repo's `scripts/setup-codex-attribution.sh`.

## CI verification

This repository also includes a GitHub Actions workflow that validates the attribution bundle on every push and pull request.

It runs:

- shell syntax checks for the managed scripts
- bootstrap into a fresh temporary Git repository
- a test commit that must include `Co-authored-by: codex <codex@openai.com>`

## Codex skill

This repo also includes a repo-local Codex skill that installs or repairs the hook setup:

```text
$install-codex-coauthor-hook
```

Skill files live here:

```text
.agents/skills/install-codex-coauthor-hook/
```

The skill wraps the existing setup script so Codex can enable the deterministic Git hook without you having to remember the shell command.

This repo also includes a second skill for adding more co-authors to the repo-local Git config:

```text
$add-ai-coauthor
```

Use that skill when you want to add another `ai.coauthor` entry such as a human collaborator or an exact trailer string you want GitHub to parse.

There is also a status skill for checking whether attribution is currently wired correctly:

```text
$show-ai-attribution-status
```

That skill reports the hook path, commit template, configured co-authors, and the trailers on the most recent commit.

## Add more co-authors

You can add more trailers without editing the hook:

```bash
git config --local --add ai.coauthor "Gemini <YOUR_GITHUB-LINKED-EMAIL>"
git config --local --add ai.coauthor "Jane Dev <jane@example.com>"
```

GitHub counts co-author contributions when the trailer email is associated with that GitHub account.

GitHub's co-author trailer format is documented here:

- https://docs.github.com/articles/creating-a-commit-with-multiple-authors

## Why the repo uses a hook

This repo uses a local Git hook because the discussion above is about adding native Codex support, which suggests manual or local automation is still the practical workaround.

## Notes

- The hook skips merge commits.
- The hook avoids adding duplicate trailers.
- Set `SKIP_AI_COAUTHORS=1` if you want to bypass injection for a single commit.
