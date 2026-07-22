import { useEffect, useRef, useState } from 'react';
import { SandSimArt } from './ProjectArt';

const FACTS = [
  ['Engine', 'C++ compiled to WebAssembly'],
  ['Renderer', 'WebGL2 compositor'],
  ['World model', 'Two material grids'],
  ['Authority', 'Web Worker or Node host'],
  ['Subsystems', '18 composed C++ systems'],
  ['WASM binary', '640,886 bytes'],
];

const PIPELINE = [
  {
    title: 'Browser input',
    detail: 'JavaScript forwards raw keyboard, pointer, resize, and network events.',
  },
  {
    title: 'Authority worker',
    detail: 'The worker advances actors and the cellular world on separate fixed clocks.',
  },
  {
    title: 'C++ engine',
    detail: 'Simulation, tools, camera policy, components, and streaming run in WebAssembly.',
  },
  {
    title: 'Presentation mirror',
    detail: 'The main thread applies compact world diffs and sends dirty regions to WebGL2.',
  },
];

const TECHNICAL_AREAS = [
  {
    title: 'Materials and cell state',
    copy: (
      <>
        Each layer stores a grid of material IDs plus simulation state such as
        velocity, lifetime, and sleep information. Material identity and flags
        are generated from <code>materials.schema.json</code>. Powders, liquids,
        and gases use the ordinary cell update paths.
      </>
    ),
  },
  {
    title: 'Components and rigid bodies',
    copy: (
      <>
        Stone, plants, wood, and ice are registered as connected components rather
        than independent pixels. Unsupported components can detach into rigid
        bodies. A body stamps its real material into the grid while moving and can
        register as a static component again after settling.
      </>
    ),
  },
  {
    title: 'Foreground and background',
    copy: (
      <>
        The engine owns foreground and background <code>Layer</code> instances.
        A step processes both layers, then runs a transfer pass for blocked powder,
        liquid, or gas cells. Solids remain in their original layer. Both layers
        use the same terrain seed but diverge after editing.
      </>
    ),
  },
  {
    title: 'World streaming',
    copy: (
      <>
        Only a window around the camera is loaded. Near an edge, the window shifts
        and the newly exposed band is generated or restored from the chunk store.
        Components, bodies, creatures, and items retain absolute-world positions,
        while their local coordinates are remapped into the new window.
      </>
    ),
  },
  {
    title: 'Rendering and camera',
    copy: (
      <>
        C++ generates material pixels and owns the camera and pointer-to-cell
        mapping. The WebGL2 presenter uploads dirty texture regions and draws the
        visible window, lighting, previews, players, creatures, and items. A world
        shift moves the existing texture with a framebuffer blit before filling
        the new band.
      </>
    ),
  },
  {
    title: 'Offline and network authority',
    copy: (
      <>
        Offline play uses a worker-owned authority and a main-thread presentation
        mirror. Multiplayer replaces the worker with a Node host using the same
        C++ engine. Clients submit inputs and inventory intents; the authority
        returns ordered diffs and actor snapshots. Only the local player is
        predicted.
      </>
    ),
  },
];

function ExternalArrow() {
  return <span aria-hidden="true">↗</span>;
}

export default function FallingSandCaseStudy() {
  const artRef = useRef(null);
  const [artActive, setArtActive] = useState(false);

  useEffect(() => {
    document.title = 'Falling Sand Engine — Nicholas Mayer-Rupert';
  }, []);

  useEffect(() => {
    const art = artRef.current;
    if (!art || typeof IntersectionObserver === 'undefined') {
      setArtActive(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setArtActive(entry.isIntersecting),
      { rootMargin: '100px 0px' },
    );
    observer.observe(art);
    return () => observer.disconnect();
  }, []);

  return (
    <main className="case-study">
      <nav className="case-nav" aria-label="Case study navigation">
        <a className="case-nav__home" href="/">Nicholas Mayer-Rupert</a>
        <div className="case-nav__links">
          <a href="/Nicholas-Mayer-Rupert-Resume.pdf">Résumé</a>
          <a href="/game">Run the game</a>
        </div>
      </nav>

      <header className="case-hero">
        <p className="case-kicker">Implementation notes</p>
        <h1>Falling Sand engine</h1>
        <p className="case-hero__lede">
          A two-layer cellular simulation with procedural terrain, connected
          components, rigid bodies, creatures, and survival mechanics. The engine
          is written in C++, compiled to WebAssembly, and presented with WebGL2.
        </p>
        <div className="case-actions">
          <a className="case-link case-link--primary" href="/game">Run the game</a>
          <a className="case-link" href="https://github.com/nicholasmayerrupert/website/tree/master/src/sand" target="_blank" rel="noopener noreferrer">
            Source code <ExternalArrow />
          </a>
          <a className="case-link" href="https://github.com/nicholasmayerrupert/website/blob/master/src/sand/README.md" target="_blank" rel="noopener noreferrer">
            Engine documentation <ExternalArrow />
          </a>
        </div>

        <div
          ref={artRef}
          className={`case-hero__art${artActive ? ' project-art-active' : ''}`}
          aria-label="Illustration of the two-layer sand engine"
        >
          <SandSimArt />
        </div>
      </header>

      <section className="case-section case-overview" aria-labelledby="overview-heading">
        <div className="case-section__label">Overview</div>
        <div className="case-section__content">
          <h2 id="overview-heading">Scope and ownership</h2>
          <p>
            React mounts a framework-free <code>&lt;sand-game&gt;</code> custom
            element. JavaScript sizes the canvas, schedules frames, forwards raw
            events, and carries worker or WebSocket messages. It does not update
            cells, calculate camera movement, or generate render pixels.
          </p>
          <p>
            The C++ engine owns the grid simulation, actor physics, material and
            tool rules, camera, world shifts, inventory, crafting, audio events,
            and WebGL2 presentation. The same compiled module runs in the browser
            presentation realm, the offline authority worker, and the multiplayer
            server.
          </p>

          <dl className="case-facts">
            {FACTS.map(([term, detail]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="case-section" aria-labelledby="pipeline-heading">
        <div className="case-section__label">Runtime</div>
        <div className="case-section__content">
          <h2 id="pipeline-heading">Update and presentation pipeline</h2>
          <p>
            Ordinary offline frames follow this path. The authority sends one
            backpressured world packet at a time; the mirror acknowledges a packet
            before the next diff is emitted.
          </p>
          <ol className="case-pipeline">
            {PIPELINE.map((step, index) => (
              <li key={step.title}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <h3>{step.title}</h3>
                <p>{step.detail}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="case-section" aria-labelledby="model-heading">
        <div className="case-section__label">Implementation</div>
        <div className="case-section__content">
          <h2 id="model-heading">Simulation model</h2>
          <div className="case-technical-grid">
            {TECHNICAL_AREAS.map((area) => (
              <article key={area.title}>
                <h3>{area.title}</h3>
                <p>{area.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="case-section" aria-labelledby="performance-heading">
        <div className="case-section__label">Example optimization</div>
        <div className="case-section__content">
          <h2 id="performance-heading">Dense TNT chains in enclosed terrain</h2>
          <p>
            A focused benchmark detonates a 79-cell TNT chain inside foreground
            and background cave mass. Five changes were measured independently:
            precomputed blast energy, a separate gas-shell stencil, one-lookup fuse
            insertion, avoiding a copied erase list, and stopping debris discovery
            after its fixed budget is full.
          </p>
          <p>
            Two other changes were removed because ablation showed no benefit. A
            shorter blast carry lifetime was also rejected because it changed the
            rolling checksum.
          </p>

          <dl className="case-benchmark">
            <div><dt>Before</dt><dd>9.902 ms</dd></div>
            <div><dt>After</dt><dd>8.960 ms</dd></div>
            <div><dt>Reaction change</dt><dd>−9.5%</dd></div>
            <div><dt>Scenario hashes</dt><dd>9 / 9 exact</dd></div>
          </dl>
          <p className="case-note">
            Values are p50 reaction time from the focused cave benchmark.
          </p>
        </div>
      </section>

      <section className="case-section" aria-labelledby="verification-heading">
        <div className="case-section__label">Verification</div>
        <div className="case-section__content">
          <h2 id="verification-heading">Determinism and tests</h2>
          <p>
            Pure performance changes are expected to preserve exact checksums.
            The test suite covers material conservation, reactions, component
            grounding, rigid collision, world shifts, player physics, inventory,
            creatures, networking, and rendering invariants. Development WASM
            builds can also run a post-step ownership validator.
          </p>
          <pre className="case-code"><code>{`npm test
node scripts/bench-sand.mjs --compare bench/baseline.json
node scripts/bench-tnt.mjs
(cd src/sand/cpp && source wasm/emenv.sh && wasm/build.sh --dev)`}</code></pre>
        </div>
      </section>

      <section className="case-run">
        <div>
          <h2>Run the current build</h2>
          <p>Survival mode requires a desktop browser with a mouse and keyboard.</p>
        </div>
        <a className="case-link case-link--primary" href="/game">Open /game</a>
      </section>

      <footer className="case-footer">
        <span>© 2026 Nicholas Mayer-Rupert</span>
        <a href="mailto:njmrme@gmail.com">njmrme@gmail.com</a>
      </footer>
    </main>
  );
}
