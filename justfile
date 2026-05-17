# ============================================================================
# mobile-template justfile
# ============================================================================
# Expo SDK 55 + Bun + Convex + WorkOS. Run `just --list` to see all recipes.
# ============================================================================

set shell := ["bash", "-cu"]
set dotenv-filename := ".env.local"

# Show available recipes
default:
    @just --list

# ============================================================================
# LOCAL DEVELOPMENT
# ============================================================================

# Start Convex dev + Expo dev server together (tmux split)
[group('dev')]
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    if command -v tmux &>/dev/null && [ -z "${TMUX:-}" ]; then
        mkdir -p ./.convex-tmp
        tmux new-session -d -s dev 'CONVEX_TMPDIR=./.convex-tmp bunx convex dev'
        tmux split-window -h -t dev 'bun run start'
        tmux attach -t dev
    else
        echo "Run in separate terminals:"
        echo "  just convex-dev"
        echo "  just start"
    fi

# Stop all dev processes (tmux session + standalone)
[group('dev')]
dev-stop:
    #!/usr/bin/env bash
    set -uo pipefail
    tmux kill-session -t dev 2>/dev/null && echo "Killed tmux dev session."
    pkill -f 'convex dev' 2>/dev/null && echo "Killed Convex dev process."
    pkill -f 'expo start' 2>/dev/null && echo "Killed Expo dev process."
    echo "Dev stopped."

# Start Expo dev server (with dev client)
[group('dev')]
start *args:
    bun run start {{ args }}

# Run on iOS simulator
[group('dev')]
ios *args:
    bun run ios {{ args }}

# Run on Android emulator / device
[group('dev')]
android *args:
    bun run android {{ args }}

# Generate native iOS/Android project directories
[group('dev')]
prebuild *args:
    bun run prebuild {{ args }}

# ============================================================================
# CONVEX UTILITIES
# ============================================================================

# Start Convex dev sync only (watches convex/, pushes to deployment).
# CONVEX_TMPDIR keeps esbuild's tmp on the same filesystem as the project — required on
# WSL where /tmp lives on a different filesystem and triggers duplicate-output errors.
[group('convex')]
convex-dev:
    mkdir -p ./.convex-tmp && CONVEX_TMPDIR=./.convex-tmp bunx convex dev

# Regenerate Convex client types from the convex/ source tree
[group('convex')]
convex-codegen:
    bunx convex codegen

# Push Convex functions to the production deployment
[group('convex')]
convex-deploy:
    bunx convex deploy

# Set a Convex environment variable (usage: just env-set KEY VALUE)
[group('convex')]
env-set key value:
    bunx convex env set -- {{ key }} "{{ value }}"

# List all Convex environment variables
[group('convex')]
env-list:
    bunx convex env list

# Sync WORKOS_* and R2_* runtime env vars from .env.local → Convex deployment
[group('convex')]
env-sync:
    #!/usr/bin/env bash
    set -euo pipefail
    ENV_FILE=".env.local"
    SYNC_PREFIXES="WORKOS_ R2_"
    if [[ ! -f "$ENV_FILE" ]]; then echo "ERROR: $ENV_FILE not found"; exit 1; fi
    echo "Fetching current Convex env…"
    declare -A CURRENT=()
    while IFS='=' read -r key value; do
        [[ -z "$key" ]] && continue
        CURRENT["$key"]="$value"
    done < <(bunx convex env list 2>/dev/null || true)
    synced=0
    skipped=0
    while IFS='=' read -r key value; do
        [[ -z "$key" || "$key" =~ ^# ]] && continue
        match=false
        for prefix in $SYNC_PREFIXES; do
            [[ "$key" == ${prefix}* ]] && match=true && break
        done
        $match || continue
        [[ -z "$value" ]] && continue
        if [[ "${CURRENT[$key]+x}" == "x" && "${CURRENT[$key]}" == "$value" ]]; then
            skipped=$((skipped + 1))
            continue
        fi
        echo "  → $key"
        bunx convex env set -- "$key" "$value"
        synced=$((synced + 1))
    done < <(grep -E '^[A-Z_]+=' "$ENV_FILE")
    echo "Synced $synced, skipped $skipped unchanged."

# ============================================================================
# BUILD & SUBMIT (EAS)
# ============================================================================

# Build production iOS bundle via EAS
[group('build')]
build-ios *args:
    bunx eas build --platform ios {{ args }}

# Build production Android bundle via EAS
[group('build')]
build-android *args:
    bunx eas build --platform android {{ args }}

# Submit iOS build to App Store Connect
[group('build')]
submit-ios *args:
    bunx eas submit --platform ios {{ args }}

# Submit Android build to Google Play
[group('build')]
submit-android *args:
    bunx eas submit --platform android {{ args }}

# Publish an Expo Updates OTA bundle to the current channel
[group('build')]
ota *args:
    bunx eas update {{ args }}

# ============================================================================
# CODE QUALITY
# ============================================================================

# Type-check the whole project
[group('quality')]
typecheck:
    bun run typecheck

# Lint with Biome
[group('quality')]
lint:
    bun run lint

# Format with Biome (writes changes)
[group('quality')]
fmt:
    bun run format

# Lint + format + organize imports (Biome check --write)
[group('quality')]
check:
    bun run check

# Run Jest unit tests once (CI mode)
[group('quality')]
test:
    bun run test

# Run Maestro E2E flows. Requires a built dev client on a simulator/device.
[group('quality')]
e2e:
    bun run test:e2e

# ============================================================================
# DEPENDENCIES
# ============================================================================

# Install all dependencies
[group('deps')]
install:
    bun install

# Update all dependencies
[group('deps')]
update:
    bun update
