import React from 'react';

const SKILL_GROUPS = [
  {
    label: 'Languages',
    items: ['C++', 'JavaScript', 'Python', 'Java', 'SQL'],
  },
  {
    label: 'Web & backend',
    items: ['React', 'Node.js', 'REST APIs', 'WebSocket', 'Cloudflare'],
  },
  {
    label: 'Systems & graphics',
    items: ['WebAssembly', 'WebGL', 'Three.js', 'Git'],
  },
];

export default function About() {
  return (
    <section className="portfolio-section about-section">
      <div className="portfolio-glow portfolio-glow--violet" aria-hidden="true" />

      <div className="portfolio-shell">
        <header className="portfolio-intro portfolio-reveal">
          <p className="portfolio-eyebrow">About</p>
          <h2>I code</h2>
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
                Built and maintained two full-stack products: a participant and
                facilitator platform with check-ins, cohort chat, progress
                visualizations, moderation, and admin tools; plus a registration
                system coordinating deferred Stripe payments, Zoom enrollment,
                calendar invites, and reminders.
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

        <section className="toolbox portfolio-reveal" aria-labelledby="skills-heading">
          <div className="toolbox__heading">
            <p className="portfolio-eyebrow">Skills</p>
            <h3 id="skills-heading">Tools I use</h3>
          </div>

          <div className="toolbox__groups">
            {SKILL_GROUPS.map((group) => (
              <article key={group.label}>
                <h4>{group.label}</h4>
                <ul>
                  {group.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
