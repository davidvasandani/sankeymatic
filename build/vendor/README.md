# Vendored runtime libraries

The page loads these from its own origin so that it makes no third-party
requests. They are the exact files jsDelivr served for the tags the upstream
page used (`d3@7`, `canvg@3`) on 2026-11-12, unmodified.

| File | Package | Version | Source | Licence | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `d3.min.js` | d3 | 7.9.2 | `https://cdn.jsdelivr.net/npm/d3@7.9.2/dist/d3.min.js` | ISC (`LICENSE-d3.txt`) | `912111098ea99503a6f4967361d2bbdc9dbf58cf9c678c8e27e5b02d1a07f0c1` |
| `canvg.umd.js` | canvg | 3.0.11 | `https://cdn.jsdelivr.net/npm/canvg@3.0.11/lib/umd.js` | MIT (`LICENSE-canvg.txt`) | `bbe9cd7a639b2290ab076aaf02852cb889e1614b5bf6a8b4ac7406a1e41fecae` |

To update: download the new version from the same URL pattern, replace the
file, and update the version and hash here. `tests/static.test.js` checks the
hashes, so a silent edit fails the tests.
