# Personal website

My portfolio site, built with React and Vite. The Skills/About section has an
interactive falling-sand physics toy you can draw into. The engine lives in
[`src/sand`](src/sand): the simulation, WebGL2 rendering, camera, and input all
run in C++/WebAssembly, and it ships as a framework-free `<sand-game>` Web
Component you can drop into any page (`npm run build:embed`).

## Running it

```
npm install
npm run dev      # local dev server
npm run build    # production build into dist/
npm run deploy   # build and deploy to Cloudflare
```

## Layout

- `src/` — the React app. `App.jsx` wires up the pages and each section
  (`Hero`, `About`, `Contact`, …) is its own component.
- `src/sand/` — the sand game: a C++/WebAssembly simulation + renderer + camera,
  a thin JS shell, and the `<sand-game>` Web Component (`src/sand/embed/`). See
  its [README](src/sand/README.md) to work on it.
- `scripts/` — helper scripts (the headless sand test, art preview rendering).


