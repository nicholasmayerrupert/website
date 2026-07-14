import React from 'react';

const TOOLBOX = [
  'C++',
  'WebAssembly',
  'JavaScript',
  'React',
  'Node.js',
  'Python',
  'Java',
  'SQL',
  'WebGL',
  'Cloudflare',
];

export default function About() {
  return (
    <section className="portfolio-section about-section">
      <div className="portfolio-glow portfolio-glow--violet" aria-hidden="true" />

      <div className="portfolio-shell">
        <header className="portfolio-intro portfolio-reveal">
          <p className="portfolio-eyebrow">About</p>
          <h2>I build stuff</h2>
          <p className="portfolio-lede">
            I&apos;m Nicholas, a software engineer who enjoys working on systems
            and web applications. I like learning how things work, solving
            technical problems, and building useful software.
          </p>
        </header>

        <div className="career-grid portfolio-reveal portfolio-reveal--delay-1">
          <article className="career-card career-card--light career-card--wide">
            <div className="career-card__topline">
              <span className="career-card__label">Current role</span>
              <span className="status-pill">
                <span aria-hidden="true" /> Current
              </span>
            </div>
            <div>
              <p className="career-card__company">Mastercard</p>
              <h3>Software Engineer I</h3>
              <p>
                I currently work on Mastercard&apos;s engineering team as a
                Software Engineer I.
              </p>
            </div>
          </article>

          <article className="career-card career-card--violet">
            <span className="career-card__label">Experience</span>
            <div>
              <p className="career-card__company">Connection Lab · 2025—2026</p>
              <h3>Full-stack SWE intern</h3>
              <p>
                Worked on a course and community platform with real-time chat,
                Stripe payments, Zoom sessions, authentication, and APIs.
              </p>
            </div>
          </article>

          <article className="career-card career-card--ink">
            <span className="career-card__label">Education</span>
            <div>
              <p className="career-card__company">Simon Fraser University</p>
              <h3>BSc Computer Science</h3>
              <p>
                Bachelor of Science in Computer Science, completed in 2026.
              </p>
            </div>
          </article>
        </div>

        <div className="toolbox portfolio-reveal">
          <p>Built with</p>
          <div className="toolbox__items" aria-label="Technical skills">
            {TOOLBOX.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
