#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/bootstrap-into-target-repo.sh [--force] /path/to/target-repo

Copies the reusable Codex attribution files into an existing Git repository and
then runs the target repo's setup-codex-attribution.sh script.
EOF
}

force=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      force=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      usage >&2
      exit 1
      ;;
    *)
      break
      ;;
  esac
done

if [[ $# -ne 1 ]]; then
  usage >&2
  exit 1
fi

script_dir=$(cd "$(dirname "$0")" && pwd)
source_root=$(cd "$script_dir/.." && pwd)

if ! target_root=$(git -C "$1" rev-parse --show-toplevel 2>/dev/null); then
  echo "Target must be an existing Git repository: $1" >&2
  exit 1
fi

if [[ "$target_root" == "$source_root" ]]; then
  echo "Target repository is already this sample repository." >&2
  exit 1
fi

managed_files=(
  ".githooks/prepare-commit-msg"
  ".gitmessage"
  "scripts/setup-codex-attribution.sh"
  ".agents/skills/install-codex-coauthor-hook/SKILL.md"
  ".agents/skills/install-codex-coauthor-hook/scripts/install.sh"
  ".agents/skills/install-codex-coauthor-hook/agents/openai.yaml"
  ".agents/skills/add-ai-coauthor/SKILL.md"
  ".agents/skills/add-ai-coauthor/scripts/manage.sh"
  ".agents/skills/add-ai-coauthor/agents/openai.yaml"
  ".agents/skills/show-ai-attribution-status/SKILL.md"
  ".agents/skills/show-ai-attribution-status/scripts/status.sh"
  ".agents/skills/show-ai-attribution-status/agents/openai.yaml"
)

conflicts=()
for rel_path in "${managed_files[@]}"; do
  source_path="$source_root/$rel_path"
  target_path="$target_root/$rel_path"

  if [[ ! -e "$target_path" ]]; then
    continue
  fi

  if cmp -s "$source_path" "$target_path"; then
    continue
  fi

  conflicts+=("$rel_path")
done

if [[ ${#conflicts[@]} -gt 0 && $force -ne 1 ]]; then
  echo "Refusing to overwrite existing files in $target_root:" >&2
  printf '  - %s\n' "${conflicts[@]}" >&2
  echo "Re-run with --force to overwrite them intentionally." >&2
  exit 2
fi

for rel_path in "${managed_files[@]}"; do
  source_path="$source_root/$rel_path"
  target_path="$target_root/$rel_path"

  mkdir -p "$(dirname "$target_path")"
  cp "$source_path" "$target_path"

  if [[ -x "$source_path" ]]; then
    chmod +x "$target_path"
  else
    chmod 0644 "$target_path"
  fi
done

"$target_root/scripts/setup-codex-attribution.sh"

echo
echo "Installed reusable Codex attribution bundle into:"
echo "  $target_root"
echo
echo "Available repo-local skills:"
find "$target_root/.agents/skills" -maxdepth 2 -name SKILL.md | sort | sed "s#^$target_root/##"
