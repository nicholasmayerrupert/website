# Box3D

Unmodified `src/`, `include/`, and `LICENSE` from
https://github.com/erincatto/box3d at commit
`47d7f7cc7e091142c08d11dc7d2e493c5d34f536`.

MIT licensed; see LICENSE. Built as C17 with WASM SIMD, linked into the separate
3D demo module. No network download is needed to rebuild. The demo uses one
physics worker (the calling thread), so no SharedArrayBuffer or site-wide
cross-origin isolation headers are required.
