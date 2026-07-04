import React, { useEffect, useState } from 'react';
import GameOfLife3D from './GameOfLife3D';

/* -------------------- DATA -------------------- */
const EXPERIENCE = [
  {
    role: 'Full-Stack Developer Intern',
    org: 'Connection Lab',
    blurb:
      'Shipped a production website end-to-end, from the REST API up through the client-side views that consumed it.',
    points: [
      'Designed REST APIs and wired them into server-rendered client views',
      'Owned schema design, wrote migrations, and tuned slow queries',
      'Implemented auth, input validation, and resilient error handling',
    ],
    tags: ['JavaScript', 'Handlebars', 'Node.js', 'SQL'],
  },
];

const SKILL_GROUPS = [
  { label: 'Languages', items: ['C++', 'Python', 'JavaScript (ES6+)', 'SQL'] },
  { label: 'Backend', items: ['REST APIs', 'Auth & sessions', 'Schema design'] },
  { label: 'Databases', items: ['PostgreSQL', 'MySQL'] },
  { label: 'Tooling', items: ['Git', 'Node.js', 'Vite'] },
];

const QUICK_FACTS = ['Full-stack', 'C++ · Python · JS · SQL', 'Systems & the web'];

/* -------------------- SMALL PARTS -------------------- */
function Chip({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[13px] font-medium text-white/85">
      {children}
    </span>
  );
}

/* -------------------- PAGE -------------------- */
export default function About() {
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Mirrors the Game of Life's own controls: when its "Life" side button opens
  // the seed editor, the intro recedes so the automaton reads as foreground.
  const [golActive, setGolActive] = useState(false);

  const introHidden = detailsOpen || golActive;

  useEffect(() => {
    if (!detailsOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setDetailsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailsOpen]);

  return (
    <section className="relative min-h-[100svh] overflow-hidden bg-[#09090b]">
      {/* Living lattice — full-bleed, interactive. Its built-in "Life" side
          button (closed by default) reopens the seed editor / controls. */}
      <div className="absolute inset-0 z-0">
        <GameOfLife3D
          className="h-full w-full"
          defaultControlsOpen={false}
          onControlsOpenChange={setGolActive}
        />
      </div>

      {/* Section-edge fades to blend with neighbours */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-24 bg-gradient-to-b from-[#09090b] to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-24 bg-gradient-to-t from-[#09090b] to-transparent" />

      {/* Intro — centred; a localised scrim keeps text legible over the lattice
          without dimming the automaton or its side button. */}
      <div
        className={`pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6 py-24 transition-all duration-500 ${
          introHidden ? 'translate-y-2 opacity-0' : 'opacity-100'
        }`}
        aria-hidden={introHidden}
      >
        <div className="relative mx-auto max-w-2xl">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-x-16 -inset-y-12 sm:-inset-x-24"
            style={{
              background:
                'radial-gradient(60% 55% at 50% 50%, rgba(9,9,11,0.94) 0%, rgba(9,9,11,0.62) 55%, rgba(9,9,11,0) 100%)',
            }}
          />

          <div className="relative text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl">
              Skills <span className="text-emerald-300/90">&amp;</span> Experience
            </h2>

            <p className="mx-auto mt-6 max-w-xl text-pretty text-base leading-relaxed text-white/75 sm:text-lg">
              I&apos;m Nicholas, a computer-science student and developer drawn to
              systems that move. The lattice drifting behind this text is a
              three-dimensional cellular automaton; the falling sand on the home
              page is a physics engine I wrote in C++ and compiled to WebAssembly.
            </p>

            <div className="mt-9 flex flex-col items-center gap-4">
              <button
                type="button"
                onClick={() => setDetailsOpen(true)}
                className="pointer-events-auto group inline-flex items-center gap-2.5 rounded-full bg-emerald-400/90 px-7 py-3.5 text-sm font-semibold text-black shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]"
              >
                Explore my experience
                <span className="transition-transform duration-300 group-hover:translate-x-0.5">
                  →
                </span>
              </button>

              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[13px] text-white/45">
                {QUICK_FACTS.map((fact, i) => (
                  <React.Fragment key={fact}>
                    {i > 0 && (
                      <span aria-hidden="true" className="text-white/20">
                        ·
                      </span>
                    )}
                    <span>{fact}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Experience / toolbox drawer — opened by the CTA, closed by × or Esc */}
      <div
        className={`absolute inset-y-0 right-0 z-30 w-full transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] sm:w-[30rem] lg:w-[34rem] ${
          detailsOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-hidden={!detailsOpen}
      >
        <div className="h-full overflow-y-auto border-l border-white/10 bg-[#0b0b0e]/92 backdrop-blur-2xl">
          <div className="min-h-full px-6 pb-14 pt-20 sm:px-9 sm:pt-24">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setDetailsOpen(false)}
                aria-label="Close panel"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 transition hover:bg-white/10 hover:text-white"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            {/* Experience timeline */}
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-300/80">
                Experience
              </h4>
              <div className="mt-4 space-y-8">
                {EXPERIENCE.map((job) => (
                  <article key={job.role} className="relative pl-7">
                    <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-4 ring-emerald-400/15" />
                    <span className="absolute bottom-0 left-[4px] top-6 w-px bg-gradient-to-b from-white/15 to-transparent" />
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <h5 className="text-lg font-semibold text-white">{job.role}</h5>
                      <span className="text-sm font-medium text-emerald-200/70">
                        {job.org}
                      </span>
                    </div>
                    <p className="mt-2 text-[15px] leading-relaxed text-white/65">
                      {job.blurb}
                    </p>
                    <ul className="mt-4 space-y-2">
                      {job.points.map((pt) => (
                        <li key={pt} className="flex gap-2.5 text-[14px] leading-relaxed text-white/70">
                          <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-emerald-300/70" />
                          <span>{pt}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {job.tags.map((t) => (
                        <Chip key={t}>{t}</Chip>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </div>

            {/* Divider */}
            <div className="my-10 h-px bg-white/10" />

            {/* Toolbox */}
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-300/80">
                Toolbox
              </h4>
              <div className="mt-5 space-y-6">
                {SKILL_GROUPS.map((group) => (
                  <div key={group.label}>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-white/45">
                      {group.label}
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {group.items.map((item) => (
                        <Chip key={item}>{item}</Chip>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
