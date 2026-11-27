#!/usr/bin/env bash
set -euo pipefail

CALLER_PWD="$PWD"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
APP_IDENTIFIER="com.branchtrace.app"
DEFAULT_DB_REL="demo/branchtrace-demo.sqlite3"
DEFAULT_PORT="1420"

usage() {
  cat <<EOF
Usage: $(basename -- "$0") [OPTIONS] [-- <extra tauri dev args>...]

Launch BranchTrace desktop app against an isolated test SQLite database
without touching the production database.

Options:
  -d, --db <PATH>          Isolated SQLite file path
                           (default: \$BRANCHTRACE_DB_PATH or ${DEFAULT_DB_REL})
  -t, --today <YYYY-MM-DD> Anchor date passed to seed_demo when generating demo data
      --keep-db            Keep existing test database instead of overwriting it
                           (seeds demo data only if the file does not exist yet)
      --empty              Use an empty test database instead of demo seed data
                           (removes existing test DB unless --keep-db is also set)
      --watch              Launch with Vite HMR + Tauri file watcher (skips frontend build)
      --skip-build         Skip frontend build in default preview mode (requires existing dist/)
  -p, --port <PORT>        Local frontend server port (default: ${DEFAULT_PORT})
      --dry-run            Print resolved configuration and commands without executing
  -h, --help               Show this help message

Examples:
  ./scripts/launch-test-db.sh
  ./scripts/launch-test-db.sh --keep-db
  ./scripts/launch-test-db.sh --today 2026-11-23
  ./scripts/launch-test-db.sh --empty --db /tmp/branchtrace-empty.sqlite3
  ./scripts/launch-test-db.sh --watch --port 1421
EOF
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

warn() {
  printf 'Warning: %s\n' "$*" >&2
}

shell_quote() {
  local s="$1"
  printf "'%s'" "${s//\'/\'\\\'\'}"
}

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

format_cmd() {
  local out=""
  local arg
  for arg in "$@"; do
    if [[ -n "$out" ]]; then
      out+=" "
    fi
    if [[ "$arg" =~ ^[A-Za-z0-9_./:@=+,%-]+$ ]]; then
      out+="$arg"
    else
      out+="$(shell_quote "$arg")"
    fi
  done
  printf '%s\n' "$out"
}

canonicalize_path() {
  local input="$1"
  local base="${2:-$CALLER_PWD}"
  local target="$input"

  if [[ "$target" != /* ]]; then
    target="$base/$target"
  fi

  if command -v realpath >/dev/null 2>&1 && realpath -m -- "$target" >/dev/null 2>&1; then
    realpath -m -- "$target"
    return 0
  fi

  # Portable fallback when GNU realpath -m is unavailable (e.g. macOS).
  local probe="$target"
  local suffix=""
  while [[ ! -e "$probe" && "$probe" != "/" && "$probe" != "." ]]; do
    suffix="/$(basename -- "$probe")$suffix"
    probe="$(dirname -- "$probe")"
  done

  local resolved_prefix=""
  if [[ -d "$probe" ]]; then
    resolved_prefix="$(cd -P -- "$probe" && pwd -P)"
  elif [[ -e "$probe" ]]; then
    resolved_prefix="$(cd -P -- "$(dirname -- "$probe")" && pwd -P)/$(basename -- "$probe")"
  else
    resolved_prefix="$probe"
  fi

  local combined="${resolved_prefix%/}${suffix}"
  printf '%s\n' "${combined:-/}"
}

assert_not_production_db() {
  local candidate="$1"
  local -a prod_dirs=()

  if [[ -n "${XDG_DATA_HOME:-}" ]]; then
    prod_dirs+=("$(canonicalize_path "$XDG_DATA_HOME/$APP_IDENTIFIER" "$ROOT_DIR")")
  fi
  if [[ -n "${HOME:-}" ]]; then
    prod_dirs+=("$(canonicalize_path "$HOME/.local/share/$APP_IDENTIFIER" "$ROOT_DIR")")
    prod_dirs+=("$(canonicalize_path "$HOME/Library/Application Support/$APP_IDENTIFIER" "$ROOT_DIR")")
  fi

  local prod_dir
  for prod_dir in "${prod_dirs[@]}"; do
    [[ -z "$prod_dir" ]] && continue
    if [[ "$candidate" == "$prod_dir" || "$candidate" == "$prod_dir/"* ]]; then
      die "Refusing to use a database inside the production app data directory: $candidate"
    fi
  done
}

DB_PATH_ARG=""
TODAY=""
KEEP_DB=0
EMPTY_DB=0
LAUNCH_MODE="preview"
SKIP_BUILD=0
PORT="$DEFAULT_PORT"
DRY_RUN=0
EXTRA_TAURI_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    -d|--db)
      [[ $# -ge 2 ]] || die "Missing path after $1"
      DB_PATH_ARG="$2"
      shift 2
      ;;
    --db=*)
      DB_PATH_ARG="${1#*=}"
      shift
      ;;
    -t|--today)
      [[ $# -ge 2 ]] || die "Missing date after $1"
      TODAY="$2"
      shift 2
      ;;
    --today=*)
      TODAY="${1#*=}"
      shift
      ;;
    --keep-db)
      KEEP_DB=1
      shift
      ;;
    --empty)
      EMPTY_DB=1
      shift
      ;;
    --watch|--dev)
      LAUNCH_MODE="watch"
      shift
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    -p|--port)
      [[ $# -ge 2 ]] || die "Missing port number after $1"
      PORT="$2"
      shift 2
      ;;
    --port=*)
      PORT="${1#*=}"
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --)
      shift
      EXTRA_TAURI_ARGS+=("$@")
      break
      ;;
    -*)
      die "Unknown option: $1 (run with --help for usage)"
      ;;
    *)
      die "Unexpected argument: $1 (pass extra tauri dev args after --)"
      ;;
  esac
done

if [[ -n "$TODAY" ]]; then
  if [[ "$EMPTY_DB" -eq 1 ]]; then
    die "--today cannot be combined with --empty"
  fi
  if [[ ! "$TODAY" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    die "Invalid --today value '$TODAY' (expected YYYY-MM-DD)"
  fi
fi

if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( 10#$PORT < 1 || 10#$PORT > 65535 )); then
  die "Invalid --port value '$PORT' (expected integer between 1 and 65535)"
fi
PORT=$((10#$PORT))

if [[ -n "$DB_PATH_ARG" ]]; then
  RAW_DB_PATH="$DB_PATH_ARG"
  DB_BASE_DIR="$CALLER_PWD"
elif [[ -n "${BRANCHTRACE_DB_PATH:-}" ]]; then
  RAW_DB_PATH="$BRANCHTRACE_DB_PATH"
  DB_BASE_DIR="$CALLER_PWD"
else
  RAW_DB_PATH="$DEFAULT_DB_REL"
  DB_BASE_DIR="$ROOT_DIR"
fi

if [[ -z "${RAW_DB_PATH//[[:space:]]/}" ]]; then
  die "Database path cannot be empty"
fi

DB_PATH="$(canonicalize_path "$RAW_DB_PATH" "$DB_BASE_DIR")"
if [[ -d "$DB_PATH" ]]; then
  die "Database path points to a directory, expected a SQLite file path: $DB_PATH"
fi
assert_not_production_db "$DB_PATH"

# Prefer the repository-local Rust toolchain when present.
if [[ -d "$ROOT_DIR/.rustup" ]]; then
  export RUSTUP_HOME="$ROOT_DIR/.rustup"
fi
if [[ -d "$ROOT_DIR/.cargo" ]]; then
  export CARGO_HOME="$ROOT_DIR/.cargo"
  if [[ -d "$ROOT_DIR/.cargo/bin" ]]; then
    export PATH="$ROOT_DIR/.cargo/bin:$PATH"
  fi
fi

command -v cargo >/dev/null 2>&1 || die "cargo not found in PATH (and no repo-local .cargo/bin found)"

USE_PNPM=0
if command -v pnpm >/dev/null 2>&1 && pnpm --version >/dev/null 2>&1; then
  USE_PNPM=1
elif [[ -x "$ROOT_DIR/node_modules/.bin/tauri" && -x "$ROOT_DIR/node_modules/.bin/vite" && -x "$ROOT_DIR/node_modules/.bin/tsc" ]]; then
  USE_PNPM=0
else
  die "Working pnpm not found and local node_modules/.bin tools are missing. Run 'pnpm install' first."
fi

SEED_CMD=()
DB_ACTION=""
if [[ "$EMPTY_DB" -eq 1 ]]; then
  if [[ "$KEEP_DB" -eq 1 && -f "$DB_PATH" ]]; then
    DB_ACTION="keep existing database (skip seeding)"
  elif [[ "$KEEP_DB" -eq 1 ]]; then
    DB_ACTION="initialize new empty database on app launch"
  else
    DB_ACTION="reset to fresh empty database"
  fi
else
  if [[ "$KEEP_DB" -eq 1 && -f "$DB_PATH" ]]; then
    DB_ACTION="keep existing database"
    if [[ -n "$TODAY" ]]; then
      warn "--keep-db is set and database already exists; ignoring --today $TODAY"
    fi
  else
    SEED_CMD=(
      cargo run
      --manifest-path "$ROOT_DIR/src-tauri/Cargo.toml"
      --bin seed_demo
      --
      --output "$DB_PATH"
    )
    if [[ -n "$TODAY" ]]; then
      SEED_CMD+=(--today "$TODAY")
    fi
    if [[ "$KEEP_DB" -eq 0 ]]; then
      SEED_CMD+=(--force)
      DB_ACTION="seed fresh demo database (overwrite)"
    else
      DB_ACTION="seed demo database (missing file)"
    fi
  fi
fi

DEV_URL="http://127.0.0.1:${PORT}"
BUILD_CMDS=()
TAURI_CMD=()

if [[ "$USE_PNPM" -eq 1 ]]; then
  if [[ "$LAUNCH_MODE" == "preview" ]]; then
    if [[ "$SKIP_BUILD" -eq 0 ]]; then
      BUILD_CMDS+=("pnpm build")
    fi
    BEFORE_DEV_CMD="pnpm preview --host 127.0.0.1 --port ${PORT} --strictPort"
    TAURI_CONFIG="{\"build\":{\"devUrl\":\"${DEV_URL}\",\"beforeDevCommand\":\"$(json_escape "$BEFORE_DEV_CMD")\"}}"
    TAURI_CMD=(pnpm tauri dev --no-watch --config "$TAURI_CONFIG")
  else
    if [[ "$PORT" -eq "$DEFAULT_PORT" ]]; then
      TAURI_CMD=(pnpm tauri dev)
    else
      BEFORE_DEV_CMD="pnpm exec vite --host 127.0.0.1 --port ${PORT} --strictPort"
      TAURI_CONFIG="{\"build\":{\"devUrl\":\"${DEV_URL}\",\"beforeDevCommand\":\"$(json_escape "$BEFORE_DEV_CMD")\"}}"
      TAURI_CMD=(pnpm tauri dev --config "$TAURI_CONFIG")
    fi
  fi
else
  VITE_BIN_QUOTED="$(shell_quote "$ROOT_DIR/node_modules/.bin/vite")"
  if [[ "$LAUNCH_MODE" == "preview" ]]; then
    if [[ "$SKIP_BUILD" -eq 0 ]]; then
      BUILD_CMDS+=("tsc+vite")
    fi
    BEFORE_DEV_CMD="${VITE_BIN_QUOTED} preview --host 127.0.0.1 --port ${PORT} --strictPort"
    TAURI_CONFIG="{\"build\":{\"devUrl\":\"${DEV_URL}\",\"beforeDevCommand\":\"$(json_escape "$BEFORE_DEV_CMD")\"}}"
    TAURI_CMD=("$ROOT_DIR/node_modules/.bin/tauri" dev --no-watch --config "$TAURI_CONFIG")
  else
    BEFORE_DEV_CMD="${VITE_BIN_QUOTED} --host 127.0.0.1 --port ${PORT} --strictPort"
    TAURI_CONFIG="{\"build\":{\"devUrl\":\"${DEV_URL}\",\"beforeDevCommand\":\"$(json_escape "$BEFORE_DEV_CMD")\"}}"
    TAURI_CMD=("$ROOT_DIR/node_modules/.bin/tauri" dev --config "$TAURI_CONFIG")
  fi
fi

if [[ ${#EXTRA_TAURI_ARGS[@]} -gt 0 ]]; then
  TAURI_CMD+=("${EXTRA_TAURI_ARGS[@]}")
fi

printf 'BranchTrace isolated test launch\n'
printf '  Repo root   : %s\n' "$ROOT_DIR"
printf '  Test DB     : %s\n' "$DB_PATH"
printf '  DB action   : %s\n' "$DB_ACTION"
printf '  Launch mode : %s (%s)\n' "$LAUNCH_MODE" "$DEV_URL"
printf '  Cargo       : %s\n' "$(command -v cargo)"
printf '  Production  : untouched (BRANCHTRACE_DB_PATH isolated)\n'

if [[ "$DRY_RUN" -eq 1 ]]; then
  printf '\nPlanned commands (dry-run):\n'
  if [[ "$EMPTY_DB" -eq 1 ]]; then
    printf '  %s\n' "$(format_cmd mkdir -p -- "$(dirname -- "$DB_PATH")")"
    if [[ "$KEEP_DB" -eq 0 ]]; then
      printf '  %s\n' "$(format_cmd rm -f -- "$DB_PATH" "${DB_PATH}-wal" "${DB_PATH}-shm")"
    fi
  fi
  if [[ ${#SEED_CMD[@]} -gt 0 ]]; then
    printf '  %s\n' "$(format_cmd "${SEED_CMD[@]}")"
  fi
  if [[ ${#BUILD_CMDS[@]} -gt 0 ]]; then
    if [[ "$USE_PNPM" -eq 1 ]]; then
      printf '  %s\n' "$(format_cmd pnpm build)"
    else
      printf '  %s\n' "$(format_cmd "$ROOT_DIR/node_modules/.bin/tsc")"
      printf '  %s\n' "$(format_cmd "$ROOT_DIR/node_modules/.bin/vite" build)"
    fi
  fi
  printf '  BRANCHTRACE_DB_PATH=%s %s\n' "$(format_cmd "$DB_PATH")" "$(format_cmd "${TAURI_CMD[@]}")"
  exit 0
fi

cd "$ROOT_DIR"

if [[ "$EMPTY_DB" -eq 1 ]]; then
  mkdir -p -- "$(dirname -- "$DB_PATH")"
  if [[ "$KEEP_DB" -eq 0 ]]; then
    rm -f -- "$DB_PATH" "${DB_PATH}-wal" "${DB_PATH}-shm"
  fi
elif [[ ${#SEED_CMD[@]} -gt 0 ]]; then
  "${SEED_CMD[@]}"
fi

if [[ "$LAUNCH_MODE" == "preview" ]]; then
  if [[ "$SKIP_BUILD" -eq 1 ]]; then
    [[ -f "$ROOT_DIR/dist/index.html" ]] || die "--skip-build was specified, but $ROOT_DIR/dist/index.html does not exist"
  elif [[ "$USE_PNPM" -eq 1 ]]; then
    pnpm build
  else
    "$ROOT_DIR/node_modules/.bin/tsc"
    "$ROOT_DIR/node_modules/.bin/vite" build
  fi
fi

export BRANCHTRACE_DB_PATH="$DB_PATH"
exec "${TAURI_CMD[@]}"
