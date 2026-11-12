# Self-hosted fonts

Latin-subset `woff2` files from the Fontsource packages (version 5.3.0),
downloaded from jsDelivr on 2026-11-12 and served from this directory so the
page makes no third-party requests. Both families are under the SIL Open Font
License 1.1.

| File | Family | Weight | Source package | Licence | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `young-serif-latin-400-normal.woff2` | Young Serif | 400 | `@fontsource/young-serif@5.3.0` | `LICENSE-young-serif.txt` | `6ba68b9927ad2a640d32cbea050ffc2b5d0ae6cbaa785afe470da9d6bf0ef39f` |
| `figtree-latin-400-normal.woff2` | Figtree | 400 | `@fontsource/figtree@5.3.0` | `LICENSE-figtree.txt` | `8f98dd642986f1fa39c45b89665a57372897c235b36028e0e4a136e43dc5f8ab` |
| `figtree-latin-500-normal.woff2` | Figtree | 500 | `@fontsource/figtree@5.3.0` | `LICENSE-figtree.txt` | `953a6a4294b1205a1b4d4b9e5529478e8c9e1c5a67a9aa24a551414cd85b6f51` |
| `figtree-latin-700-normal.woff2` | Figtree | 700 | `@fontsource/figtree@5.3.0` | `LICENSE-figtree.txt` | `7ec4f08d09f91d349917dd6592f6aaae66d8fe1bbd58fa24707961e79236616e` |

Source URL pattern:
`https://cdn.jsdelivr.net/npm/@fontsource/<family>@5.3.0/files/<file>`.

Only the latin subset is shipped. Text outside it falls back to the system
serif or sans-serif.
