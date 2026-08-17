#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-src}"

SEARCH_TOOL=""
if command -v rg >/dev/null 2>&1; then
  SEARCH_TOOL="rg"
elif command -v grep >/dev/null 2>&1; then
  SEARCH_TOOL="grep"
else
  echo "Design-law check requires rg or grep."
  exit 2
fi

# 1) Comfortaa quarantine: only allowed in four locked locations.
allowed_paths=(
  "src/components/DPWallpaper.jsx"
  "src/components/RecordShelf.css"
  "src/components/PSCWordmark.css"
  "src/styles/identity.css"
  "src/App.css"
)

if [[ "$SEARCH_TOOL" == "rg" ]]; then
  mapfile -t comfortaa_lines < <(rg -n --glob '!*.md' "Comfortaa|comfortaa" "$ROOT" || true)
else
  mapfile -t comfortaa_lines < <(grep -RsnE "Comfortaa|comfortaa" "$ROOT" --include='*.jsx' --include='*.js' --include='*.tsx' --include='*.ts' --include='*.css' --include='*.html' || true)
fi
if [[ ${#comfortaa_lines[@]} -gt 0 ]]; then
  bad=()
  for line in "${comfortaa_lines[@]}"; do
    path="${line%%:*}"
    ok=false
    for allowed in "${allowed_paths[@]}"; do
      if [[ "$path" == "$allowed" ]]; then
        ok=true
        break
      fi
    done
    if [[ "$ok" == "false" ]]; then
      bad+=("$line")
    fi
  done

  if [[ ${#bad[@]} -gt 0 ]]; then
    echo "Design-law check failed: Comfortaa used outside whitelist."
    printf '%s\n' "${bad[@]}"
    exit 1
  fi
fi

# 2) Deprecated font families must not appear in source.
if [[ "$SEARCH_TOOL" == "rg" ]]; then
  rg -n "Cormorant|Geist" "$ROOT" >/tmp/psc_design_font_failures.txt 2>/dev/null || true
else
  grep -RsnE "Cormorant|Geist" "$ROOT" --exclude-dir=node_modules --exclude-dir=dist >/tmp/psc_design_font_failures.txt 2>/dev/null || true
fi

if [[ -s /tmp/psc_design_font_failures.txt ]]; then
  echo "Design-law check failed: deprecated font reference found (Cormorant/Geist)."
  cat /tmp/psc_design_font_failures.txt
  exit 1
fi

# 3) Active UI must not reintroduce deprecated space-themed display language.
# Scope is intentionally narrow to active surface files to avoid legacy CSS false positives.
active_files=(
  "src/App.jsx"
  "src/entry/EntrySequence.jsx"
  "src/console/ArchitectConsole.jsx"
)

banned_literal_regex='BLACK STAR|THE SUN|SOLAR|GALAXY|ORBIT|WARP|CHAKRA|STARFIELD'

tmp_banned="/tmp/psc_design_phrase_failures.txt"
rm -f "$tmp_banned"

for file in "${active_files[@]}"; do
  if [[ "$SEARCH_TOOL" == "rg" ]]; then
    rg -n -i "$banned_literal_regex" "$file" >> "$tmp_banned" 2>/dev/null || true
  else
    grep -nEi "$banned_literal_regex" "$file" >> "$tmp_banned" 2>/dev/null || true
  fi
done

if [[ -s "$tmp_banned" ]]; then
  filtered_tmp="$(mktemp)"
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    if [[ "$line" =~ (fontFamily|font-family|font:|font[[:space:]]*:) ]]; then
      continue
    fi
    printf '%s\n' "$line" >> "$filtered_tmp"
  done < "$tmp_banned"

  if [[ -s "$filtered_tmp" ]]; then
    echo "Design-law check failed: banned space-themed display language found in active UI files."
    cat "$filtered_tmp"
    rm -f "$filtered_tmp"
    exit 1
  fi
  rm -f "$filtered_tmp"
fi

# 4) Listener room stage must stay wired to ListenerShell in App.
room_stage_guard='if \(stage === ["'\'' ]*room["'\'' ]* && !activeNode\)'
listener_shell_tag_guard='<ListenerShell'
listener_shell_prop_guard='sessionMeta=\{sessionMeta\}'

if [[ "$SEARCH_TOOL" == "rg" ]]; then
  rg -n "$room_stage_guard" "src/App.jsx" >/tmp/psc_listener_room_guard.txt 2>/dev/null || true
else
  grep -nE "$room_stage_guard" "src/App.jsx" >/tmp/psc_listener_room_guard.txt 2>/dev/null || true
fi

if [[ ! -s /tmp/psc_listener_room_guard.txt ]]; then
  echo "Design-law check failed: App room stage guard is missing."
  exit 1
fi

if [[ "$SEARCH_TOOL" == "rg" ]]; then
  rg -n "$listener_shell_tag_guard" "src/App.jsx" >/tmp/psc_listener_shell_guard.txt 2>/dev/null || true
else
  grep -nE "$listener_shell_tag_guard" "src/App.jsx" >/tmp/psc_listener_shell_guard.txt 2>/dev/null || true
fi

if [[ ! -s /tmp/psc_listener_shell_guard.txt ]]; then
  echo "Design-law check failed: App room stage is not rendering ListenerShell with required props."
  exit 1
fi

if [[ "$SEARCH_TOOL" == "rg" ]]; then
  rg -n "$listener_shell_prop_guard" "src/App.jsx" >/tmp/psc_listener_shell_prop_guard.txt 2>/dev/null || true
else
  grep -nE "$listener_shell_prop_guard" "src/App.jsx" >/tmp/psc_listener_shell_prop_guard.txt 2>/dev/null || true
fi

if [[ ! -s /tmp/psc_listener_shell_prop_guard.txt ]]; then
  echo "Design-law check failed: ListenerShell sessionMeta prop is missing."
  exit 1
fi

echo "Design-law check passed."
