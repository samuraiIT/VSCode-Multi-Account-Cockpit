#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)

cd "$repo_root"

bash -n \
  .githooks/prepare-commit-msg \
  scripts/setup-codex-attribution.sh \
  scripts/bootstrap-into-target-repo.sh \
  .agents/skills/install-codex-coauthor-hook/scripts/install.sh \
  .agents/skills/add-ai-coauthor/scripts/manage.sh \
  .agents/skills/show-ai-attribution-status/scripts/status.sh \
  src/hello.sh

test_repo=$(mktemp -d "${TMPDIR:-/tmp}/codex-coauthor-verify.XXXXXX")
cleanup() {
  rm -rf "$test_repo"
}
trap cleanup EXIT

git -C "$test_repo" init -b main >/dev/null
git -C "$test_repo" config user.name "Verification Bot"
git -C "$test_repo" config user.email "verify@example.com"

cat > "$test_repo/README.md" <<'EOF'
# verification target
EOF

git -C "$test_repo" add README.md
git -C "$test_repo" commit -m "Initial verification commit" >/dev/null

"$repo_root/scripts/bootstrap-into-target-repo.sh" "$test_repo" >/dev/null

[[ "$(git -C "$test_repo" config --local --get core.hooksPath)" == ".githooks" ]]
[[ "$(git -C "$test_repo" config --local --get commit.template)" == ".gitmessage" ]]
[[ "$(git -C "$test_repo" config --local --get-all ai.coauthor)" == "codex <codex@openai.com>" ]]

for skill in \
  add-ai-coauthor \
  install-codex-coauthor-hook \
  show-ai-attribution-status
do
  [[ -f "$test_repo/.agents/skills/$skill/SKILL.md" ]]
done

cat > "$test_repo/note.txt" <<'EOF'
bundle verified
EOF

git -C "$test_repo" add .
git -C "$test_repo" commit -m "Verify bootstrapped attribution" >/dev/null

commit_body=$(git -C "$test_repo" show -s --format=%B HEAD)
grep -Fxq "Co-authored-by: codex <codex@openai.com>" <<<"$commit_body"

"$test_repo/.agents/skills/show-ai-attribution-status/scripts/status.sh" >/dev/null

echo "Attribution bundle verification passed."
