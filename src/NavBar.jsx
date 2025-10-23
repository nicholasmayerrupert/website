import React, { useEffect, useState } from 'react';

const NAV_ITEMS = [
  { label: 'HOME', href: '#home' },
  { label: 'SKILLS', href: '#skills' },
  { label: 'PROJECTS', href: '#projects' },
  { label: 'CONTACT', href: '#contact' },
];

const NavBar = () => {
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

  const handleClick = (href) => {
    setActiveHref(href);
  };

  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-2 rounded-full border border-white/20 bg-white/[0.04] px-3 py-2 backdrop-blur-xl shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
        {NAV_ITEMS.map((item) => (
          <a
            key={item.href}
            href={item.href}
            onClick={() => handleClick(item.href)}
            className={`px-4 py-2 text-sm font-medium rounded-full transition ${
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
