# Prototype Instructions

## Appeye product decisions (2026-09-08)

This folder is a standalone, mock-data product prototype tracked by GitHub issue #35. Never connect it to the production API/database or replace the service on port 3000. The user chose displayed visual option 1, saved as `reference/selected-home.png`: a navy left navigation, white main surface, a six-country comparison table and four daily event rows. Match that hierarchy; use the existing Appeye logo and packaged flag/line-icon assets.

The product serves invitation-only customer spaces, sharing market facts while keeping research private. Customer pages show confirmed lending apps, label automatic versus human confirmation, prioritize personal cash loans, and do not contain AI analysis. Prototype role/workspace switching is a demonstration, not production security.

Required additional interactions: sort the entire filtered application dataset before pagination; retain current lists until the user applies detected updates; preserve origin/filter/sort/page/scroll on detail return. App details include a thumbnail screenshot gallery with lightbox and compact permission rows with expand-all. Always label generated gallery media as demo material, never a real store capture. Keep missing/unsupported/error/success-empty states distinct, including App Store Android-permission unavailability.

Read `../../docs/requirements/RESEARCH-PROTOTYPE.md` for the complete accepted prototype requirements. Keep the Product Design runtime and hosting files intact. The CEO owns package/runtime/assets and visual QA; CTO owns `src/` and logic tests, PM owns requirements/final acceptance, and Alex owns independent QA. Coordinate before crossing file boundaries.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
