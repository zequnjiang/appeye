# Design QA — Appeye research prototype

final result: passed

## Latest scoped annotation update — #37 (2026-09-09)

Source truth is the user's four library annotations, together with the actual pre-edit library capture `reference/qa/library-polish/before.png`. The preceding homepage review below remains historical evidence for #35; it is not used as a pixel reference for the library. This update changes only the default sort, icon slot and two date columns.

- Matched state: TH / Google Play / personal cash loans, cumulative installs descending, first page, researcher identity. Both before/after captures use the requested 1254×964 CSS viewport and are emitted by IAB as 1239×952 pixel images; they are compared at equal raster size without rescaling either side independently. The source capture already had the user's manually selected install sort; a fresh-session and reset test separately prove the new default.
- Full same-input comparison: `reference/qa/library-polish/comparison.png` (before left, after right). Focused comparison: `reference/qa/library-polish/focused-comparison.png` (before above, after below). The focused crop deliberately covers sort, table headers and the first rows. The last date column remains reachable through the existing table's horizontal scroll, as in the user's reference.
- Implementation: `reference/qa/library-polish/after-desktop.png`, `library-390.png`, and `icon-failed.png`. At 390 CSS pixels the page document is 375px plus browser scrollbar, table container 287px and scrollable table 990px; no page-level overflow. Icons are 40×40 CSS pixels. The saved narrow screenshot contains 11 TH/GP rows because that test explicitly applied one new mock identity; reset returns the initial fixture.
- Typography: existing font family, weights, row text sizes, wrapping and heading hierarchy retained. Icon introduction leaves names and developers legible; full text remains in the horizontally scrollable table.
- Layout rhythm: 40px icon with 12px gap fits the existing row; no new panels, table controls, row selection changes or page navigation changes. The before/after row density and header placement remain aligned.
- Tokens: navy, teal, muted text, white surfaces and existing table borders remain unchanged; new icons use local raster colors and a subtle missing-image surface.
- Image quality: the generated 1536×1024 atlas has exact 6×4 square cells, rendered at proportional 240×160 within the 40px crop. The actual screenshot shows distinct, crisp symbols with no adjacent-tile bleed. It is explicitly fictional, not store-collected. TH19 has a meaningful missing-image symbol; AR20 deliberately exercises local load failure without a broken image. A new identity has no inherited icon.
- Copy/content: headers now read 商店发布时间 → 最近更新时间, bound to `releasedAt` → `storeUpdatedAt`. TH19 shows 2025-07-19 and 2026-08-21, while its detail retains first-seen 2026-08-19 and collected 2026-09-08. Google Play retains cumulative/non-country language; Apple stays 未公开.

No actionable P0/P1/P2 visual mismatch was found in the matched comparison; no visual fix iteration was required. A pre-reload HMR session still held old fixture objects without icon fields; the final comparisons and functional tests use fresh fixtures, not that intermediate development state. The initial narrow test retained its search after IAB `fill('')`; actual keyboard clearing produced the archived normal-icon screenshot. These are recorded as test setup observations, not silently relabeled product failures or passes.

Actual browser facts are in `reference/qa/library-polish/browser-evidence.json`: fresh/reset default, default first/last pages, optional first-seen sort, score page 3 detail return with unchanged IDs, pending list retention, explicit application/new missing-icon identity, TH19 date/detail, AR20 failure and narrow geometry. Final console error/warn entries since the implementation load are empty; the intentionally missing raster is separately tested. The browser was operated by CEO; Alex independently reviews these artifacts alongside engineering checks. This scope does not re-test all existing prototype flows or production integrations.

Latest scoped final result: passed.

Reviewed 2026-09-09, Asia/Shanghai. This approves the independent product prototype, not a production migration.

## Comparison target

- Source: `reference/selected-home.png`, option 1 selected by the user, 1487 × 1058 pixels.
- Implementation: `http://127.0.0.1:4173/`, independent mock frontend.
- State: 2026-09-08, customer researcher, default personal cash loans, no pending changes applied.
- CSS viewport: 1487 × 1058, devicePixelRatio 1.
- Browser: Codex in-app browser. Native tab screenshot is used because an initial full-page screenshot produced an incorrectly scaled raster; that raster is excluded from visual judgments.

## Initial comparison

Source and browser capture were combined in the same image before review:

- Full: `../../.artifacts/research-home-comparison-native.png`.
- Focused country table: `../../.artifacts/research-table-comparison-initial.png`.
- Additional focused header and events: `../../.artifacts/research-header-comparison-initial.png`, `../../.artifacts/research-events-comparison-initial.png`.
- Browser raster: `../../.artifacts/research-home-native.png`, 1487 × 1058. No geometric rescaling was applied to the selected source or native browser capture.

Findings:

1. P1: brand wordmark absent in the first implementation. Restore the existing eye asset plus Appeye brand text. CTO has corrected the component.
2. P2: country rows used 13px body text and 12px action labels, visibly smaller than the target. Increase row text to 14px and action labels to 13px; preserve 54px rows.
3. P2: country table began about 9px too low, pushing the featured section down. Reduce scope-row bottom spacing by 8px.
4. P2: event rows exceeded the intended rhythm. Reduce vertical cell padding to 8px, retaining readable 14px body text and 12px secondary text.
5. P2: inner-page gallery inherited horizontal layout on the section itself. Apply horizontal scrolling to `.screenshot-grid`, retain heading above it; add semantic facts, compact permission and context styles to the actual component classes.

All listed fixes were applied and the revised implementation was recaptured at the same viewport and compared in the same input with the source. Final evidence is tracked below.

## Required fidelity surfaces

- Typography: DM Sans variable for Latin/numeric content with system PingFang SC / Microsoft YaHei Chinese fallback; 34px page heading, 24px featured heading, 14px table body. Final wrapping and hierarchy reviewed in focused comparisons. Native glyph shapes/antialiasing differ slightly from the generated raster (P3), without changing readability or density.
- Layout: 214px navy sidebar, 57px top bar, 33px content side padding, six-country table and four event rows follow selected hierarchy. Final country header is 72px, all six rows 54px; table starts y=215.90, featured divider y=643.40. Body is exactly 1487 × 1058 without page overflow. At 817px/390px, controls remain inside the viewport and wide tables scroll within their containers.
- Color: navy `#101a2e`, ink `#14223b`, teal `#079d94`, quiet gray table headers, separate teal/blue/purple event labels.
- Assets: existing Appeye eye, packaged flags, Lucide line icons. Generated gallery images are local, visibly synthetic, and shown without cropping. No fake screenshot or store data is represented as real.
- Copy: prototype labels retained; “精选 4 条” deliberately replaces ambiguous “共 4 条”. Package IDs come from consistent fictional identities. “最近动态” is derived from same-scope observed events, replacing inconsistent relative-time prose in the raster. Interactive date field and explicit Beijing-time label are intentional functional adaptations. No AI conclusions or compliance verdicts are introduced.

## Final comparison and iteration history

The [final full comparison](reference/qa/home-comparison-final.png) places source left and implementation right. Focused comparisons place source above implementation: [header and country table](reference/qa/header-table-comparison-final.png), [events](reference/qa/events-comparison-final.png). Both artifacts were opened together before judgment. The final [browser capture](reference/qa/home-final.png) and selected source are each 1487 × 1058 pixels, CSS viewport 1487 × 1058, devicePixelRatio 1; no geometric resizing was used for comparison. An early malformed full-page capture is excluded, as explained above.

Additional P2 findings discovered during interaction/responsive review were fixed and recaptured:

- The phone filter popover escaped the main column and its demo label disappeared. Anchoring it to the toolbar makes its final 390px bounds x=72–374; page scrollWidth is 390. A mobile header badge remains visible.
- Permission content was too tall. Compact secondary details share a line; desktop has two columns, phone one. The HTML hidden rule now suppresses failed-image remnants.
- StrictMode dialog cleanup lost the screenshot entrance focus. A stable entrance ref, close-before-focus ordering and next-frame guard fix it. The final real button Enter → Escape check restores `screenshot-0` (BUTTON).
- Count-button padding and a redundant home footer added height and a scrollbar. Corrected padding yields six exact 54px rows; only the redundant home footer is hidden while the sidebar demo marker remains. Final content begins x=247 and ends x=1454, matching source proportions.

The final combined full and focused review has no actionable P0/P1/P2 difference. Remaining P3 differences are native font/raster rendering, small flat-color versus raster-shading variation, and minor icon/column optical alignment. Tokens preserve navy, teal and event semantic colors. Generated media retains its embedded text and portrait ratio; no source image was redrawn using HTML or custom icons.

Responsive captures: [817px home](reference/qa/home-817.png), [817px library](reference/qa/library-817.png), [390px home](reference/qa/home-390.png), [390px library](reference/qa/library-390.png), [390px permissions](reference/qa/permissions-390.png). Inner pages: [desktop detail](reference/qa/detail-desktop.png), [lightbox](reference/qa/lightbox-desktop.png). These images were inspected, not inferred from code.

## Interaction evidence and limitations

The root agent operated IAB; Alex independently reviewed the captures and [browser facts](reference/qa/browser-evidence.json), alongside separate logical/build checks. The evidence does not imply Alex physically performed the clicks.

Verified flows include exact country event/source/return; sorted page-three return with identical focused-row scroll; pending list stability and explicit application; four-app comparison and fifth-app rejection; image keyboard/close/focus; six-to-ten permissions plus success-empty, failed-old, uncollected and Apple-unsupported states; intentional broken image and retry; empty date; group creation/rename/detail return; source excerpt to scoped collection export; workspace notes and per-user read isolation; read-only controls; invitation pending/acceptance; package request/operator intake/customer detail; and platform denial of private customer research. All seven demo identities were selected during checks. Failed initial probes remain recorded rather than being rewritten as passes.

The browser page-assets inventory observed 26 assets (16 scripts, 5 stylesheets, 4 images, 1 font), all on port 4173 with no external URL. This is an observed asset inventory, not a complete packet capture. Source checks separately confirm no production/collector/invitation integration. The warning/error window after final clean module reload is empty. Earlier HMR development errors and intentional failed-image testing are kept separate.

IAB did not emit a download event in two recorded Markdown attempts. The implemented fallback offers complete preview, copy and select-all alongside an accurately labeled download attempt. The visible 823-character North export exactly matched the clipboard and independently checked expected output. [North export](reference/qa/north-export.md) and [scoped collection export](reference/qa/collection-export.md) are file-tool copies of visible text, not claimed browser downloads. PM requirement v1.2 explicitly accepts this prototype boundary.

## Final checklist

- Same-input full and focused comparisons completed after all visual fixes.
- Desktop, 817px and 390px captures inspected; persistent controls and compact permissions remain usable.
- Primary interaction results and final console window recorded, including real limitations.
- No unresolved P0/P1/P2 design issue; P3 optical polish does not block handoff.
- Local preview remains running. Production service and database are untouched; no external publication is part of this handoff.
