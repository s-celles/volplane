# VOLPLANE — task runner (https://github.com/casey/just)
# Run `just` to list the recipes. `just check` runs everything a commit should pass.

# The port the NMEA simulator listens on (Condor's default)
nmea_port := "4353"

# List available recipes
default:
    @just --list

# Install dependencies (frozen lockfile, like CI)
install:
    bun install --frozen-lockfile

# Core tests (bun): parser, navigation, purity, capabilities
test:
    bun test

# Shell tests (Rust): the TCP pump — newline contract, packet reassembly
test-rust:
    cargo test --manifest-path src-tauri/Cargo.toml

# Type-check only (no emit)
typecheck:
    bun run typecheck

# Everything a commit should pass: type-check, core tests, shell tests
check: typecheck test test-rust coverage

# The Condor stand-in: NMEA on tcp://127.0.0.1:{{nmea_port}} — run `just dev` in another terminal, click Connect
sim port=nmea_port:
    bun run scripts/nmea-sim.ts {{port}}

# The app, live-reloaded (starts the frontend server via beforeDevCommand)
dev:
    bun run tauri dev

# Production bundles for this machine's platform (.app/.dmg on macOS)
build:
    bun run tauri build

# Regenerate every platform icon from the single source, assets/icon.png
icons:
    bun run tauri icon assets/icon.png --output src-tauri/icons

# Remove build output (frontend bundle and Rust target)
clean:
    rm -rf dist src-tauri/target

# What is built, what is not — and a table that cannot lie about it.
# It FAILS on an `unverified` row: a requirement nobody has looked at is not done and is not
# missing. It is a question, and a build that goes green over an open question has learned to lie.
coverage:
    bun run scripts/coverage.ts

# Android debug build (arm64)
android:
    bun run tauri android build --debug --target aarch64

# Android dev build and install
android-dev:
    bun run tauri android dev
