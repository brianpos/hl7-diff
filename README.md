# FHIR Spec Diff Viewer

A client-side single-page application for comparing two FHIR specification pages side by side, highlighting differences between them.

Built with Vue 3, Vuetify, and Vite. The HTML diff computation runs in a Web Worker to keep the UI responsive.

## Features

- Enter two URLs to compare and view an inline diff of the HTML content
- Navigation controls to jump between changes (keyboard shortcuts: `,` / `.` for prev/next, `<` / `>` to skip sections)
- Configurable allowlist of permitted sites via `public/allowed-sites.json`
- Proxy support for sites that don't allow direct cross-origin requests
- Relative links in the diff output are rewritten to produce new diff comparisons

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

Starts the dev server on `http://localhost:3000`.

## Production Build

```bash
npm run build
```

Output is written to `dist/`. This is a static SPA with no server-side rendering — serve the `dist/` folder with any static file server.

```bash
npm run preview
```

Preview the production build locally.

## Configuration

The list of allowed sites for comparison is defined in `public/allowed-sites.json`. This file is copied as-is to the build output and can be edited post-build without rebuilding the application.
