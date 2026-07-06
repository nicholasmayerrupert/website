import React, { useEffect, useState } from 'react';
import GameOfLife3D from './GameOfLife3D';

/* -------------------- DATA -------------------- */
const EXPERIENCE = [
  {
    role: 'Software Engineer I',
    org: 'Mastercard',
    dates: 'August 2026 – Present',
    blurb: "Joined Mastercard's engineering team as a Software Engineer I.",
    points: [],
    tags: [],
  },
  {
    role: 'Full-Stack Developer Intern',
    org: 'Connection Lab',
    dates: 'May 2025 – July 2026',
    blurb:
      'Built a comprehensive course-and-community platform end-to-end, spanning real-time chat, payments, and Zoom-powered live sessions.',
    points: [
      'Built real-time chat with WebSocket, storing shared images on Amazon S3',
      'Integrated Stripe to handle payments and checkout',
      'Automated live sessions via the Zoom API, auto-creating meetings and syncing scheduling and attendance',
      'Managed user sign-in and authentication, with validation and resilient error handling',
      'Designed REST APIs, migrated databases, and tuned slow queries',
    ],
    tags: [
      'JavaScript',
      'Handlebars',
      'Node.js',
      'WebSocket',
      'Stripe',
      'Zoom API',
      'AWS S3',
      'SQL',
    ],
  },
];

const EDUCATION = {
  school: 'Simon Fraser University',
  field: 'Computer Science',
  dates: '2022 – 2026',
};

const SKILL_GROUPS = [
  { label: 'Languages', items: ['C++', 'Python', 'Java', 'JavaScript (ES6+)', 'SQL'] },
  { label: 'Backend', items: ['REST APIs', 'Auth & sessions', 'Schema design'] },
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

function SectionLabel({ children }) {
  return (
    <h4 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-300/80">
      {children}
    </h4>
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
    <section className="relative min-h-[100svh] overflow-hidden bg-dark">
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
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-24 bg-gradient-to-b from-dark to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-24 bg-gradient-to-t from-dark to-transparent" />

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
                'radial-gradient(60% 55% at 50% 50%, rgba(18,18,18,0.94) 0%, rgba(18,18,18,0.62) 55%, rgba(18,18,18,0) 100%)',
            }}
          />

          <div className="relative text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl">
              Skills &amp; Experience
            </h2>

            <p className="mx-auto mt-6 max-w-xl text-pretty text-base leading-relaxed text-white/75 sm:text-lg">
              I&apos;m Nicholas, a software engineer and computer-science
              graduate drawn to systems that move. The lattice drifting behind
              this text is a three-dimensional cellular automaton; the falling
              sand on the home page is a physics engine I wrote in C++ and
              compiled to WebAssembly.
            </p>

            <div className="mt-9 flex flex-col items-center gap-4">
              <button
                type="button"
                onClick={() => setDetailsOpen(true)}
                className="pointer-events-auto group inline-flex items-center gap-2.5 rounded-full bg-emerald-400/90 px-7 py-3.5 text-sm font-semibold text-black shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-dark"
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

      {/* Experience / education / toolbox — centred modal, opened by the CTA.
          Kept off the right edge, which is reserved for the lattice controls. */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          detailsOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setDetailsOpen(false)}
        aria-hidden="true"
      />
      <div
        className={`fixed inset-0 z-40 flex items-center justify-center p-4 transition-opacity duration-300 ${
          detailsOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!detailsOpen}
      >
        <div
          className={`relative flex max-h-[86svh] w-[min(94vw,44rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#161616]/95 shadow-2xl backdrop-blur-2xl transition-transform duration-300 ${
            detailsOpen ? 'scale-100' : 'scale-95'
          }`}
        >
          <button
            type="button"
            onClick={() => setDetailsOpen(false)}
            aria-label="Close panel"
            className="absolute right-4 top-4 z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white/70 transition hover:bg-white/15 hover:text-white"
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

          <div className="overflow-y-auto px-6 py-9 sm:px-10 sm:py-11">
            {/* Experience timeline */}
            <SectionLabel>Experience</SectionLabel>
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
                  <div className="mt-1 text-xs font-medium uppercase tracking-wide text-white/40">
                    {job.dates}
                  </div>
                  {job.blurb && (
                    <p className="mt-3 text-[15px] leading-relaxed text-white/65">
                      {job.blurb}
                    </p>
                  )}
                  {job.points.length > 0 && (
                    <ul className="mt-4 space-y-2">
                      {job.points.map((pt) => (
                        <li key={pt} className="flex gap-2.5 text-[14px] leading-relaxed text-white/70">
                          <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-emerald-300/70" />
                          <span>{pt}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {job.tags.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {job.tags.map((t) => (
                        <Chip key={t}>{t}</Chip>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>

            <div className="my-9 h-px bg-white/10" />

            {/* Education */}
            <SectionLabel>Education</SectionLabel>
            <div className="relative mt-4 pl-7">
              <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-white/70 ring-4 ring-white/10" />
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h5 className="text-lg font-semibold text-white">
                  {EDUCATION.school}
                </h5>
                <span className="text-sm font-medium text-white/50">
                  {EDUCATION.dates}
                </span>
              </div>
              <p className="mt-1 text-[15px] text-white/65">{EDUCATION.field}</p>
            </div>

            <div className="my-9 h-px bg-white/10" />

            {/* Toolbox */}
            <SectionLabel>Toolbox</SectionLabel>
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
    </section>
  );
}
