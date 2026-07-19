import React, { useEffect, useRef, useState } from 'react';
import GameOfLife3D from './GameOfLife3D';
import { ChessArt, SandSimArt, WildfireArt } from './ProjectArt';

const PROJECTS = [
  {
    Art: SandSimArt,
    title: 'Falling Sand',
    eyebrow: 'C++ · WebAssembly · WebGL2',
    description:
      'A two-layer falling-sand simulation with rigid bodies, lighting, creatures, and procedural terrain.',
    detail: 'The engine powering this site',
    href: '#home',
    cta: 'Play above',
    size: 'project-card--wide',
  },
  {
    Art: ChessArt,
    title: 'LLM Chess Coach',
    eyebrow: 'Artificial intelligence',
    description:
      'A chess assistant that plays games and analyzes moves with Stockfish and an LLM.',
    detail: 'Terminal opponent · Move analysis',
    href: 'https://github.com/nicholasmayerrupert/cmpt419chess',
    cta: 'View on GitHub',
    size: 'project-card--half',
  },
  {
    Art: WildfireArt,
    title: 'Forest Fire Modelling',
    eyebrow: 'Data science',
    description:
      'Models comparing environmental factors associated with wildfire risk and spread.',
    detail: 'Feature analysis · Predictive modelling',
    size: 'project-card--half',
  },
];

function ProjectCard({ project }) {
  const content = (
    <>
      <div className="project-card__art" aria-hidden="true">
        <project.Art />
      </div>
      <div className="project-card__copy">
        <p className="project-card__eyebrow">{project.eyebrow}</p>
        <h3>{project.title}</h3>
        <p className="project-card__description">{project.description}</p>
        <div className="project-card__footer">
          <span>{project.detail}</span>
          {project.cta && (
            <span className="project-card__cta">
              {project.cta} <span aria-hidden="true">↗</span>
            </span>
          )}
        </div>
      </div>
    </>
  );

  const className = `project-card ${project.size}`;
  if (!project.href) return <article className={className}>{content}</article>;

  const external = project.href.startsWith('http');
  return (
    <a
      className={className}
      href={project.href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      aria-label={`${project.title}: ${project.cta}`}
    >
      {content}
    </a>
  );
}

export default function TileGrid() {
  const sectionRef = useRef(null);
  const [artActive, setArtActive] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setArtActive(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setArtActive(entry.isIntersecting),
      { rootMargin: '100px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      className={`portfolio-section projects-section bento-section${artActive ? ' bento-section--active' : ''}`}
    >
      <div className="portfolio-glow portfolio-glow--blue" aria-hidden="true" />
      <div className="portfolio-shell">
        <header className="projects-header portfolio-reveal">
          <div>
            <p className="portfolio-eyebrow">Selected work</p>
            <h2>Things I&apos;ve built</h2>
          </div>
        </header>

        <div className="projects-grid portfolio-reveal portfolio-reveal--delay-1">
          {PROJECTS.map((project) => (
            <ProjectCard key={project.title} project={project} />
          ))}
        </div>

        <article className="life-showcase portfolio-reveal">
          <div className="life-showcase__stage">
            <GameOfLife3D
              className="h-full w-full"
              defaultControlsOpen
              intro={(
                <div className="life-showcase__copy">
                  <div className="life-showcase__heading">
                    <p className="portfolio-eyebrow">Three.js · Cellular automata</p>
                    <h3>Game of Life, in 3D.</h3>
                  </div>
                </div>
              )}
              labDetails={(
                <div className="life-lab__details">
                  <p>
                    Conway&apos;s Game of Life on a finite 16×16 torus, with each
                    generation stacked as a new 3D layer.
                  </p>
                  <div className="life-showcase__stats" aria-label="Rare seed statistics">
                    <span><strong>5,024</strong> frame loop</span>
                    <span><strong>5,200</strong> generations</span>
                  </div>
                  <p className="life-showcase__discovery">
                    After searching hundreds of millions of random 16×16 soups,
                    this is the only non-trivial attractor I&apos;ve found. This seed
                    reaches its 5,024-frame cycle after 176 transient generations.
                  </p>
                </div>
              )}
            />
          </div>
        </article>
      </div>
    </section>
  );
}
