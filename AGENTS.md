# Repository Guidelines

## Project Structure & Module Organization

- BranchTrace is an offline-first Tauri 2 application using React, TypeScript, Rust, and SQLite.
- `src/` contains the shell (`App.tsx`), views (`views/`), modals (`modals/`), shared UI (`components/`, `hooks/`), Tauri API wrapper (`api.ts`), lazy browser mock (`mock/`), DTOs (`types.ts`), and styles (`index.css`).
- `src-tauri/src/` contains commands and lifecycle handling (`lib.rs`), database modules (`db/`), and Rust DTOs (`models.rs`).
- `src-tauri/migrations/` holds SQL migrations; `docs/` holds requirements and API contracts; `assets/` contains screenshots; `src-tauri/icons/` contains desktop icons.

## Build, Test, and Development Commands

- `pnpm install`: install frontend dependencies using the committed lockfile.
- `pnpm dev`: start Vite at `http://127.0.0.1:1420` with mock data persisted in localStorage.
- `pnpm tauri dev`: launch the desktop application with the Rust backend and SQLite.
- `pnpm build`: run TypeScript checks and build the frontend into `dist/`.
- `pnpm preview`: serve the frontend build locally.
- `pnpm tauri build`: build desktop bundles; requires Rust and platform-specific Tauri prerequisites.
- `cargo test --manifest-path src-tauri/Cargo.toml`: run backend tests.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`: check Rust formatting.

## Coding Style & Naming Conventions

- TypeScript uses strict checking, two-space indentation, single quotes, and no semicolons. Use PascalCase for components/types and camelCase for functions/variables.
- Rust uses edition 2021 and rustfmt conventions: four-space indentation, snake_case functions/modules, and PascalCase types.
- Keep Tauri command names snake_case and serialized DTO fields camelCase. Update Rust models, TypeScript types, and API wrappers together.
- No ESLint or Prettier configuration currently exists; follow surrounding code.

## Testing Guidelines

- Rust tests use `#[test]` in `src-tauri/src/db/tests.rs`; database tests apply the real migration to in-memory SQLite. Use descriptive snake_case names.
- Add regression coverage for changed date, version, tree, transaction, and trash behavior.
- Selector tests (Node 24): `node --test tests/*.test.mjs`; no coverage threshold is configured.
- For UI changes, run `pnpm build` and smoke-test browser mocks and native persistence. Consult the acceptance cases in `docs/01_MVP_需求规格.md`.

## Commit & Pull Request Guidelines

- Only `first commit` exists; no convention is established. Use short, imperative subjects.
- PRs should explain behavior changes, link relevant issues, list validation performed, and include screenshots for UI changes. Update affected API or requirements documents.

## Architecture & Data Safety

- Route native writes through Tauri commands to the single database worker; keep validation and transactions in Rust.
- Store `branchtrace.sqlite3` in the OS application-data directory. Add versioned migrations for schema changes; keep local databases, logs, and build output out of commits.
