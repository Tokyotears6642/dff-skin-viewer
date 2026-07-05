# Extracted 0.7.0 Package Notes

This branch was prepared from the provided `SkinViewer-GTA-SA-Suite-0.7.0.rar` package so the original maintainer can review the changes against the public upstream repository.

## Source Package

- Archive: `SkinViewer-GTA-SA-Suite-0.7.0.rar`
- App package inspected: `resources/app.asar`
- Package metadata version: `0.7.0`

## What Was Applied To This Branch

- `electron/main.cjs` from the 0.7.0 package.
- `electron/preload.cjs` from the 0.7.0 package.
- `dist/` from the 0.7.0 package as a compiled frontend reference.
- `package.json` version updated to `0.7.0`.

## What Could Not Be Restored From The Package

The packaged app did not contain the unbundled React/Vite frontend source directory (`src/`) or sourcemap files. Because of that, the frontend changes are only present as the compiled files under `dist/`.

For a clean maintainable PR, the `src/` changes should be restored manually from the development copy if available.

## Review-Relevant Areas

`electron/main.cjs` includes notable additions or expanded flows around:

- Auto update status/install handling.
- TXD texture export, import, save, and backup creation.
- Pipeline package generation for 3ds Max and Blender.
- DFF roundtrip bridge generation for GTA Tools / 3ds Max.
- MTA single-skin and batch resource generation.
- Favorites export/copy handling.
- Smoke test capture scenarios.

`electron/preload.cjs` exposes corresponding bridge APIs for the renderer process.

