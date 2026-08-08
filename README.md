# Personal website

My portfolio site, built with React and Vite. Its centerpiece is an
interactive falling-sand game served at `/game`. The engine lives in
[`src/sand`](src/sand): the simulation, WebGL2 rendering, camera, and input all
run in C++/WebAssembly, and it ships as a framework-free `<sand-game>` Web
Component you can drop into any page (`npm run build:embed`). See
[`src/sand/README.md`](src/sand/README.md) for the engine architecture.

## Running it

```
npm install
npm run dev        # local dev server
npm run build      # production build into dist/
npm run build:full # rebuild both WASM engines, then build the site
npm run deploy     # build and deploy to Cloudflare
```

## Layout

- `src/` — the React app. `App.jsx` wires up the pages and each section
  (`Hero`, `About`, `Contact`, …) is its own component.
- `work/falling-sand/` — the dedicated Falling Sand engineering case-study
  entry; its React view lives in `src/FallingSandCaseStudy.jsx`.
- `resume/` — editable LaTeX résumé source; the generated one-page PDF is
  committed under `public/`.
- `src/sand/` — the sand game: a C++/WebAssembly simulation + renderer + camera,
  a thin JS shell, and the `<sand-game>` Web Component (`src/sand/embed/`). See
  its [README](src/sand/README.md) to work on it.
- `scripts/` — headless test suites, benchmarks, and the authoritative
  multiplayer server (`npm run sand:server`). `npm test` runs the headless
  suites with two workers; `npm run test:all` also runs lint, builds, and browser
  tests.
