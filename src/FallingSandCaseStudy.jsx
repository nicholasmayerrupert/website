import React, { useEffect } from 'react';
import { SandSimArt } from './ProjectArt';

const ENGINE_AREAS = [
  {
    number: '01',
    title: 'One engine, two complete worlds',
    copy: 'Foreground and background are independently simulated grids. Powders, liquids, gases, reactions, components, lighting, and generated terrain all run in both layers, with deliberate transfer rules between them.',
  },
  {
    number: '02',
    title: 'Components instead of painted pixels',
    copy: 'Stone, plants, ice, and structures retain connected-component identity. They can detach, collide as rigid bodies, break apart, and settle back into terrain without becoming visual-only props.',
  },
  {
    number: '03',
    title: 'A world larger than the viewport',
    copy: 'The loaded window streams horizontally through a procedural landscape. Chunk storage preserves edits and bodies while the camera moves, so digging into a mountain remains meaningful after leaving and returning.',
  },
  {
    number: '04',
    title: 'Determinism as a design constraint',
    copy: 'Fixed input streams produce reproducible engine state. Checksums protect optimization work from accidental behavior changes and provide the foundation for prediction and server-authoritative multiplayer.',
  },
];

const METRICS = [
  ['2', 'fully simulated layers'],
  ['18', 'composed engine subsystems'],
  ['640 KB', 'production WASM binary'],
  ['9 / 9', 'TNT scenarios checksum-stable'],
];

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

export default function FallingSandCaseStudy() {
  useEffect(() => {
    document.title = 'Falling Sand Engineering Case Study — Nicholas Mayer-Rupert';
  }, []);

  return (
    <main className="case-study">
      <nav className="case-nav" aria-label="Case study navigation">
        <a className="case-nav__home" href="/">Nicholas Mayer-Rupert</a>
        <div className="case-nav__links">
          <a href="/Nicholas-Mayer-Rupert-Resume.pdf">Résumé</a>
          <a className="case-button case-button--small" href="/game">Play the game <Arrow /></a>
        </div>
      </nav>

      <header className="case-hero">
        <p className="case-eyebrow">Engineering case study · C++ / WebAssembly / WebGL2</p>
        <h1>Falling Sand,<br /><span>built from the particles up.</span></h1>
        <p className="case-hero__lede">
          A procedural sandbox and survival game whose simulation, rendering,
          camera, tools, and world streaming are written in C++ and compiled to
          WebAssembly.
        </p>
        <div className="case-hero__actions">
          <a className="case-button" href="/game">Play survival <Arrow /></a>
          <a className="case-button case-button--ghost" href="https://github.com/nicholasmayerrupert/website/tree/master/src/sand" target="_blank" rel="noopener noreferrer">
            Explore the source <Arrow />
          </a>
        </div>

        <div className="case-hero__art bento-section--active" aria-label="Illustration of the two-layer sand engine">
          <SandSimArt />
        </div>
      </header>

      <section className="case-summary" aria-labelledby="overview-heading">
        <p className="case-eyebrow">The project</p>
        <div>
          <h2 id="overview-heading">A browser game that treats the browser like a systems platform.</h2>
          <p>
            The first version was a small cellular automaton. It grew into an
            infinite, horizontally streamed world with structural components,
            rigid bodies, creatures, survival progression, lighting, sound,
            and multiplayer. React only places the framework-free
            <code>&lt;sand-game&gt;</code> element; the engine owns the behavior.
          </p>
        </div>
      </section>

      <section className="case-metrics" aria-label="Project metrics">
        {METRICS.map(([value, label]) => (
          <div key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </section>

      <section className="case-architecture" aria-labelledby="architecture-heading">
        <div className="case-section-heading">
          <p className="case-eyebrow">Architecture</p>
          <h2 id="architecture-heading">Thin shell, authoritative engine.</h2>
          <p>
            Offline play uses the same authority-and-replica shape as multiplayer.
            A worker owns the world; the main thread presents a compact mirror and
            predicts only the local player.
          </p>
        </div>

        <div className="architecture-flow" role="img" aria-label="Browser input flows to a worker authority and C++ WebAssembly engine, then compact differences return to the WebGL2 presenter">
          <div className="architecture-node architecture-node--browser">
            <span>Browser shell</span>
            <strong>Input · audio · transport</strong>
          </div>
          <span className="architecture-arrow" aria-hidden="true">→</span>
          <div className="architecture-node architecture-node--worker">
            <span>Worker authority</span>
            <strong>World · actors · inventory</strong>
          </div>
          <span className="architecture-arrow" aria-hidden="true">→</span>
          <div className="architecture-node architecture-node--engine">
            <span>C++ / WebAssembly</span>
            <strong>Simulation · camera · policy</strong>
          </div>
          <span className="architecture-arrow architecture-arrow--return" aria-hidden="true">↓</span>
          <div className="architecture-node architecture-node--presenter">
            <span>Presentation mirror</span>
            <strong>World diffs · WebGL2</strong>
          </div>
        </div>
      </section>

      <section className="case-engineering" aria-labelledby="engineering-heading">
        <div className="case-section-heading">
          <p className="case-eyebrow">Engineering decisions</p>
          <h2 id="engineering-heading">The difficult parts became the architecture.</h2>
        </div>
        <div className="case-engineering__grid">
          {ENGINE_AREAS.map((area) => (
            <article key={area.number}>
              <span>{area.number}</span>
              <h3>{area.title}</h3>
              <p>{area.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="case-performance" aria-labelledby="performance-heading">
        <div className="case-performance__copy">
          <p className="case-eyebrow">Performance without behavioral drift</p>
          <h2 id="performance-heading">Measure, isolate, verify.</h2>
          <p>
            Engine work is benchmarked before and after. Deterministic terrain and
            scenario checksums make it possible to reject fast-looking changes
            that subtly alter the world.
          </p>
        </div>
        <div className="case-performance__result">
          <strong>9.5%</strong>
          <span>faster dense-cave TNT reaction pass</span>
          <p>Five independently ablated optimizations retained. Every scenario hash remained exact.</p>
        </div>
      </section>

      <section className="case-lessons" aria-labelledby="lessons-heading">
        <p className="case-eyebrow">What I learned</p>
        <div>
          <h2 id="lessons-heading">Performance is easier to trust when correctness is measurable.</h2>
          <p>
            The most valuable work was rarely a clever inner loop in isolation.
            It was defining ownership, making state transitions observable, and
            building tests strong enough to simplify hot paths confidently.
          </p>
          <p>
            The result is both a game and a long-running systems laboratory: new
            mechanics exercise the same component, streaming, rendering, and
            networking boundaries instead of bypassing them.
          </p>
        </div>
      </section>

      <section className="case-cta">
        <p className="case-eyebrow">Try it yourself</p>
        <h2>Dig, build, and break the world.</h2>
        <div>
          <a className="case-button" href="/game">Play the game <Arrow /></a>
          <a className="case-button case-button--ghost" href="/">Return to portfolio</a>
        </div>
      </section>

      <footer className="case-footer">
        <span>© 2026 Nicholas Mayer-Rupert</span>
        <a href="mailto:njmrme@gmail.com">njmrme@gmail.com</a>
      </footer>
    </main>
  );
}
