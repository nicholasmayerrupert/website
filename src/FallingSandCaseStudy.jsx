import { useEffect, useRef, useState } from 'react';
import { SandSimArt } from './ProjectArt';

const PROJECT_FACTS = [
  ['Origin', 'JavaScript canvas prototype'],
  ['Simulation', 'C++ compiled to WebAssembly'],
  ['Presentation', 'WebGL2'],
  ['World model', 'Two streamed material layers'],
];

const HISTORY = [
  {
    title: 'The simulation begins inside the About page',
    copy:
      'The first version was a JavaScript canvas inside About.jsx. It simulated sand, water, and connected stone, with input, rendering, material rules, and the update loop in one React component.',
  },
  {
    title: 'Simulation code is separated and measured',
    copy:
      'The update rules moved into src/sand/engine.js and the page became a client of that engine. The same change added a deterministic benchmark, recorded baselines, and a seeded random source for repeatable workloads.',
  },
  {
    title: 'A loaded window replaces the fixed world',
    copy:
      'A sliding buffer made horizontal travel unbounded, then a chunk store preserved edits and bodies when regions left memory. Vertical streaming expanded the buffer into a two-axis window over procedural terrain.',
  },
  {
    title: 'The cellular core moves to C++ and WebAssembly',
    copy:
      'The initial C++ port covered the double-buffered grid, loose-material passes, dirty tracking, and paint operations. A parity harness compared it with the JavaScript engine before components, reactions, rigid bodies, and world generation were ported and the legacy engine was removed.',
  },
  {
    title: 'Rendering and interaction become engine responsibilities',
    copy:
      'Pixel generation, WebGL2 presentation, the camera, pointer mapping, and input policy moved into C++. JavaScript was reduced to lifecycle and event forwarding, and the runtime was packaged as a framework-free sand-game Web Component. The engine also gained a second fully simulated layer.',
  },
  {
    title: 'The engine becomes the multiplayer authority',
    copy:
      'The original browser-hosted relay was replaced by a headless Node server running the same WebAssembly engine. Browsers became clients that submit validated intents and receive world, actor, item, and inventory state.',
  },
  {
    title: 'Engine ownership is divided into named subsystems',
    copy:
      'The coordinator was reduced by extracting camera, networking, terrain, rendering, items, inventory, players, tools, reactions, explosives, growth, components, and rigid-body responsibilities. A development validator began checking component and body ownership after each step.',
  },
  {
    title: 'Offline simulation moves off the main thread',
    copy:
      'Creative and offline play adopted an authority worker. One engine advances the world in the worker while another applies backpressured differences and presents the result on the main thread. This is still the basis of the current offline runtime.',
  },
  {
    title: 'Structural and fluid behavior converge on the rigid-body system',
    copy:
      'Supported structural materials and detached assemblies were given one placement and motion path. Pressure-based liquid coupling replaced simpler buoyancy rules, and compound collision shapes allowed concave, hollow, long, and mixed-material bodies to retain their real geometry.',
  },
  {
    title: 'New mechanics extend shared engine systems',
    copy:
      'Later work added target-masked spatial forces, preserved plant growth through rigid transitions, and propagated TNT ignition across moving rigid material. These changes use the same component, force, reaction, and body ownership rules rather than separate browser-side effects.',
  },
];

const RUNTIME_STAGES = [
  {
    number: '01',
    title: 'Browser shell',
    copy: 'Sizes the canvas, forwards raw input, manages audio, and carries worker or WebSocket messages.',
  },
  {
    number: '02',
    title: 'Authority engine',
    copy: 'A worker offline or a Node host in multiplayer advances cells, actors, tools, inventory, and streaming.',
  },
  {
    number: '03',
    title: 'State transport',
    copy: 'Backpressured world differences, actor snapshots, and full recovery snapshots cross the runtime boundary.',
  },
  {
    number: '04',
    title: 'Presentation engine',
    copy: 'The main-thread engine applies the mirror, predicts the local player, owns the camera, and renders with WebGL2.',
  },
];

const ENGINE_PROBLEMS = [
  {
    title: 'Material cells and structural ownership',
    copy:
      'Sand, liquids, and gases can exist as ordinary grid cells. Stone, ice, wood, and plants must also belong to a connected component or moving body. Keeping material identity and ownership synchronized prevents invisible collisions, flicker, and lost cells after cuts or motion.',
  },
  {
    title: 'Rigid bodies inside a cellular world',
    copy:
      'A detached assembly keeps a per-cell material map, collides as a compound body, displaces loose material, and can interact with liquid pressure. After it becomes quiet on grounded support, it can register as static terrain again without losing its internal materials.',
  },
  {
    title: 'Two fully simulated layers',
    copy:
      'Foreground and background each have their own grid, components, bodies, reactions, and persistent state. Both are stepped under one tick, followed by explicit transfer and cross-layer support work. Rendering simply presents the resulting depth relationship.',
  },
  {
    title: 'An infinite world in a finite buffer',
    copy:
      'The engine stores only a window around the camera. World shifts save changed regions by absolute coordinate, restore or generate entering bands, and remap components, bodies, actors, and items while keeping their world positions stable.',
  },
];

const REVERTED_WORK = [
  'A detached-terrain optimization was removed after the broader falling behavior proved unreliable.',
  'Removing pauses from large TNT chains was reverted when uninterrupted fronts were not yet safe.',
  'A dense neutronium tail-latency change was reverted instead of keeping an unstable performance result.',
];

export default function FallingSandCaseStudy() {
  const artRef = useRef(null);
  const [artActive, setArtActive] = useState(false);

  useEffect(() => {
    document.title = 'Falling Sand Engine — Project History';
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
          <a href="https://github.com/nicholasmayerrupert/website/tree/master/src/sand" target="_blank" rel="noopener noreferrer">
            Source code
          </a>
          <a href="/game">Run the game</a>
        </div>
      </nav>

      <header className="case-hero">
        <p className="case-kicker">Engine development history</p>
        <h1>Falling Sand</h1>
        <p className="case-hero__lede">
          The project began as a JavaScript canvas inside this site&apos;s About
          section. Its current form is a C++ simulation compiled to WebAssembly,
          with two material layers, streamed procedural terrain, component-backed
          structures, rigid-body physics, and a WebGL2 presenter.
        </p>
        <div className="case-actions">
          <a className="case-link case-link--primary" href="/game">Run the current build</a>
          <a className="case-link" href="https://github.com/nicholasmayerrupert/website/blob/master/src/sand/README.md" target="_blank" rel="noopener noreferrer">
            Read the engine documentation <span aria-hidden="true">↗</span>
          </a>
        </div>

        <dl className="case-facts" aria-label="Engine summary">
          {PROJECT_FACTS.map(([term, detail]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{detail}</dd>
            </div>
          ))}
        </dl>

        <figure className="case-hero__figure">
          <div
            ref={artRef}
            className={`case-hero__art${artActive ? ' project-art-active' : ''}`}
            aria-label="Animated illustration of the two-layer sand engine"
          >
            <SandSimArt />
          </div>
          <figcaption>
            The site uses the same engine package for the creative homepage and
            the standalone game runtime.
          </figcaption>
        </figure>
      </header>

      <section className="case-section case-history" aria-labelledby="history-heading">
        <div className="case-section__intro">
          <p className="case-section__label">Development history</p>
          <h2 id="history-heading">How the engine changed</h2>
          <p>
            These milestones were selected from the complete repository history.
            They mark changes to the engine&apos;s ownership, execution model, or
            simulation model rather than every material and gameplay addition.
          </p>
        </div>

        <ol className="case-history__list">
          {HISTORY.map((entry, index) => (
            <li key={entry.title}>
              <span className="case-history__index">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <h3>{entry.title}</h3>
                <p>{entry.copy}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="case-section" aria-labelledby="runtime-heading">
        <div className="case-section__intro">
          <p className="case-section__label">Current runtime</p>
          <h2 id="runtime-heading">Authority and presentation are separate</h2>
          <p>
            Offline and multiplayer execution use the same engine rules. The
            authority location changes, but JavaScript does not reimplement the
            simulation.
          </p>
        </div>

        <ol className="case-runtime">
          {RUNTIME_STAGES.map((stage) => (
            <li key={stage.number}>
              <span>{stage.number}</span>
              <h3>{stage.title}</h3>
              <p>{stage.copy}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="case-section" aria-labelledby="problems-heading">
        <div className="case-section__intro">
          <p className="case-section__label">Simulation model</p>
          <h2 id="problems-heading">Four recurring engine problems</h2>
          <p>
            Most later features depend on these boundaries. They determine how
            material identity survives movement, editing, streaming, and
            presentation.
          </p>
        </div>

        <div className="case-problems">
          {ENGINE_PROBLEMS.map((problem, index) => (
            <article key={problem.title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h3>{problem.title}</h3>
              <p>{problem.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="case-section" aria-labelledby="verification-heading">
        <div className="case-section__intro">
          <p className="case-section__label">Verification</p>
          <h2 id="verification-heading">Performance work is checked against behavior</h2>
          <p>
            The first engine extraction added deterministic workloads before the
            C++ rewrite began. The current benchmark records phase timing, work
            volume, streaming cost, rendering cost, and a terrain checksum.
            Focused suites cover component ownership, rigid collisions, fluids,
            world shifts, networking, actors, and rendering invariants.
          </p>
          <p>
            Development builds can validate component and body ownership after
            every step. Pure refactors are expected to preserve exact checksums;
            intentional behavior changes require an explained baseline update.
          </p>
        </div>

        <div className="case-reverts">
          <h3>Changes that did not remain</h3>
          <p>
            The history also contains optimizations that were removed when their
            behavior or stability was not acceptable.
          </p>
          <ul>
            {REVERTED_WORK.map((item) => (
              <li key={item}>
                <p>{item}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="case-section case-reflection" aria-labelledby="reflection-heading">
        <div className="case-section__intro">
          <p className="case-section__label">Engineering approach</p>
          <h2 id="reflection-heading">What changed in my process</h2>
        </div>
        <div className="case-reflection__copy">
          <p>
            The early version made new materials easy to add because the entire
            program lived in one component. It also meant that resizing, input,
            rendering, and simulation state could affect one another without a
            clear boundary.
          </p>
          <p>
            The main change in my approach was to define ownership before adding
            more behavior. The engine owns rules and state transitions; the
            browser owns lifecycle and transport. Tests and benchmarks describe
            the contract between those parts. That structure has made later work
            easier to evaluate because changes have a specific subsystem,
            invariant, and measurement path.
          </p>
        </div>
      </section>

      <section className="case-run" aria-labelledby="run-heading">
        <div>
          <p className="case-section__label">Current build</p>
          <h2 id="run-heading">Run the engine</h2>
          <p>The standalone game requires a desktop browser with a mouse and keyboard.</p>
        </div>
        <div className="case-run__actions">
          <a className="case-link case-link--primary" href="/game">Open /game</a>
          <a className="case-link" href="/">Return to the portfolio</a>
        </div>
      </section>

      <footer className="case-footer">
        <span>© 2026 Nicholas Mayer-Rupert</span>
        <a href="mailto:njmrme@gmail.com">njmrme@gmail.com</a>
      </footer>
    </main>
  );
}
