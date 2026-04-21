# FHIR Spec Diff Viewer

A client-side single-page application for comparing two FHIR specification pages side by side, highlighting differences between them.

Built with Vue 3, Vuetify, and Vite. The HTML diff computation runs in a Web Worker to keep the UI responsive.

## Features

- Enter two URLs to compare and view an inline diff of the HTML content
- Navigation controls to jump between changes (keyboard shortcuts: `,` / `.` for prev/next, `<` / `>` to skip sections)
- Configurable allowlist of permitted sites via `public/allowed-sites.json`
- Proxy support for sites that don't allow direct cross-origin requests
- Relative links in the diff output are rewritten to produce new diff comparisons

## How it works

All logic lives in [src/App.vue](src/App.vue). The flow is:

1. **Startup** — On mount, the app fetches `allowed-sites.json` (the domain allowlist). If `?old=…&new=…` query parameters are present, comparison starts automatically; otherwise the user sees a form with two URL fields.

2. **Validation** — Both URLs are checked against the allowlist: they must use `https://` and their host + path must match an allowed prefix.

3. **Download** — Both pages are fetched in parallel with Axios. Download progress is shown inline on each URL field. If a proxy prefix is configured (`downloaderPrefix`), URLs are wrapped through it to bypass CORS restrictions.

4. **Extract & rebase** — The `<body>` content is extracted from each HTML response via regex. Relative `href`/`src` attributes in the `<head>` (CSS, fonts, etc.) and `<body>` (images, etc.) are rewritten to absolute URLs so assets still load correctly.

5. **Diff** — The two body HTML strings are sent to a Web Worker ([src/workers/htmldiff.worker.ts](src/workers/htmldiff.worker.ts)) which runs `htmldiff-js` to produce a single HTML string with `<ins>` and `<del>` tags marking additions, deletions, and modifications.

6. **Link rewriting** — Relative links in the diff output are rewritten so that clicking a link generates a new diff comparison URL (`?old=…&new=…`) rather than navigating to the raw spec page.

7. **Render** — The entire current document is replaced via `document.open()` / `document.write()` / `document.close()` with a full HTML page containing the new page's `<head>` styles, the diff markup, colour-coded highlighting CSS, and an inline navigation script. This destroys the Vue app — pressing back triggers a full page reload to re-bootstrap it.

8. **Navigation** — The injected script collects all diff elements, filters to leaf-level only, and provides prev/next buttons (and keyboard shortcuts `,` `.` `<` `>`) to jump between changes. A binary search on element positions keeps scrolling fast even with thousands of diffs.


## Security Notes

This application fetches HTML from remote FHIR specification sites and renders it directly into the page using `document.write()` — **this is intentionally XSS-vulnerable by design**. The fetched content (including CSS, markup, and potentially scripts) is not sanitized, because faithful rendering of the original pages is desired for meaningful diffing.

### Mitigations in place

| Control | Detail |
|---------|--------|
| **HTTPS only** | `isUrlAllowed()` rejects any URL whose protocol is not `https:` |
| **Domain allowlist** | Only sites listed in `public/allowed-sites.json` (currently ~54 HL7/FHIR domains) can be fetched; host **and** path prefix must match |
| **`javascript:` link filtering** | `rewriteRelativeLinks()` regex-skips `javascript:`, `data:`, and `mailto:` href values |
| **No credentials sent** | Axios requests do not set `withCredentials`, so no cookies or auth tokens leak to fetched sites |
| **Web Worker isolation** | The HTML diff computation runs in a dedicated Worker; only string data is exchanged via `postMessage` |

### Accepted risks

- **Script / style injection** — any `<script>` or malicious CSS on an allowed site will execute in the viewer's origin after `document.write()`. Trust is delegated entirely to the allowlist. If an allowed site is compromised, injected scripts could:
  - **Same-origin cookie/auth theft** — if the viewer shares an origin with other apps (e.g. hosted at `hl7.org/diff/`), scripts can read cookies and make authenticated requests to every other app on that origin.
  - **Service Worker persistence** — `navigator.serviceWorker.register()` could install a persistent worker scoped to the viewer's path, surviving page reloads and intercepting future requests.
  - **Phishing** — replace the rendered page with a fake login form; the URL bar still shows the trusted viewer domain, making it convincing.
  - **Web API abuse** — clipboard access, notification prompts, geolocation prompts, etc., all appear to come from the trusted viewer domain.
- **No Content-Security-Policy** — the app ships without a CSP meta tag or header. Adding a strict CSP would break the rendered diff pages (inline styles, external FHIR-site CSS, etc.).
- **`innerHTML` parsing** — `DOMParser` and `innerHTML` are used to rebase URLs and rewrite links. These run in the main page context before `document.write()` replaces the document.
- **Post-build mutable allowlist** — `allowed-sites.json` is a static asset that can be edited after build without recompiling. Deployment environments should protect this file from unauthorized modification.

### Deployment recommendations

1. **Host on a dedicated subdomain** (e.g. `https://diff.fhir.org`) rather than a path under a shared domain (e.g. `hl7.org/diff/`). A separate origin means injected scripts cannot read cookies or make authenticated requests to other apps on the parent domain — this neutralises the most serious same-origin risks listed above.
2. Restrict write access to `allowed-sites.json` in production.
3. If a reverse proxy is available, set `X-Frame-Options: DENY` to prevent click-jacking. On a dedicated subdomain with no auth or sensitive actions the practical risk is low, but the header is a cheap defence-in-depth measure.

> Note: Only use the proxy/downloader service (`downloaderPrefix`) for local development. Or use the version of this project hosted on the fhirpath-lab (ask Brian Postlethwaite), and ensure has appropriate allow lists too.

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
