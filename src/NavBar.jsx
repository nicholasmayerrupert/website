import { useEffect, useState } from 'react';

const NAV_ITEMS = [
  { label: 'HOME', href: '#home', section: true },
  { label: 'ABOUT', href: '#skills', section: true },
  { label: 'WORK', href: '#projects', section: true },
  { label: 'CONTACT', href: '#contact', section: true },
];

const NavBar = ({ mobileHidden = false }) => {
  const [activeHref, setActiveHref] = useState(NAV_ITEMS[0].href);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const { hash } = window.location;
    if (hash) setActiveHref(hash);

    const handleHashChange = () => {
      setActiveHref(window.location.hash || NAV_ITEMS[0].href);
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return undefined;
    const sections = NAV_ITEMS
      .filter((item) => item.section)
      .map((item) => ({ item, element: document.querySelector(item.href) }))
      .filter(({ element }) => element);
    if (!sections.length) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (!visible.length) return;
        visible.sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top));
        setActiveHref(`#${visible[0].target.id}`);
      },
      { rootMargin: '-18% 0px -68% 0px', threshold: 0 },
    );
    sections.forEach(({ element }) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  const handleClick = (href) => {
    setActiveHref(href);
  };

  return (
    <div data-site-navbar className={`fixed left-1/2 top-2 z-50 w-fit max-w-[calc(100%-1rem)] -translate-x-1/2 ${mobileHidden ? 'hidden md:block' : ''}`}>
      <div className="flex items-center justify-center gap-0.5 rounded-full border border-white/20 bg-white/[0.04] px-1.5 py-2 shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:gap-2 sm:px-3">
        {NAV_ITEMS.map((item) => (
          <a
            key={item.href}
            href={item.href}
            onClick={item.section ? () => handleClick(item.href) : undefined}
            target={item.external ? '_blank' : undefined}
            rel={item.external ? 'noopener noreferrer' : undefined}
            aria-current={item.section && activeHref === item.href ? 'location' : undefined}
            className={`rounded-full px-2 py-2 text-[11px] font-medium transition sm:px-4 sm:text-sm ${
              activeHref === item.href
                ? 'bg-white/70 text-black shadow-lg'
                : 'text-white/70 hover:text-white/90 hover:bg-white/10'
            }`}
          >
            {item.label}
          </a>
        ))}
      </div>
    </div>
  );
};

export default NavBar;
