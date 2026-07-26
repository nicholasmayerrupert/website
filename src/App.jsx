import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import NavBar from './NavBar';
import Hero from './Hero';
import './Portfolio.css';

const About = lazy(() => import('./About'));
const TileGrid = lazy(() => import('./TileGrid'));
const Contact = lazy(() => import('./Contact'));
const SECTION_IDS = ['skills', 'projects', 'contact'];

const readHashTarget = () => {
  if (typeof window === 'undefined') return null;
  const id = window.location.hash.slice(1);
  return id === 'home' || SECTION_IDS.includes(id) ? id : null;
};

function ReadySection({ id, onReady, children }) {
  useEffect(() => onReady(id), [id, onReady]);
  return children;
}

function LazySection({ id, minHeight = '100svh', forceVisible = false, onReady, children }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(() => {
    if (typeof window === 'undefined') return true;
    return forceVisible || window.location.hash === `#${id}`;
  });

  useEffect(() => {
    if (forceVisible) setVisible(true);
  }, [forceVisible]);

  useEffect(() => {
    if (visible) return undefined;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '700px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [id, visible]);

  return (
    <div id={id} ref={ref} style={{ minHeight }}>
      {visible ? (
        <Suspense fallback={null}>
          <ReadySection id={id} onReady={onReady}>{children}</ReadySection>
        </Suspense>
      ) : null}
    </div>
  );
}

const App = () => {
  const [sandActive, setSandActive] = useState(false);
  const [hashTarget, setHashTarget] = useState(readHashTarget);
  const [readySections, setReadySections] = useState(() => new Set());
  const hashSectionIndex = SECTION_IDS.indexOf(hashTarget);

  const handleSectionReady = useCallback((id) => {
    setReadySections((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    const updateHashTarget = () => setHashTarget(readHashTarget());
    window.addEventListener('hashchange', updateHashTarget);
    return () => window.removeEventListener('hashchange', updateHashTarget);
  }, []);

  useEffect(() => {
    if (!hashTarget) return undefined;
    const required = hashSectionIndex >= 0
      ? SECTION_IDS.slice(0, hashSectionIndex + 1)
      : [];
    if (!required.every((id) => readySections.has(id))) return undefined;

    const frame = requestAnimationFrame(() => {
      document.getElementById(hashTarget)?.scrollIntoView();
    });
    return () => cancelAnimationFrame(frame);
  }, [hashSectionIndex, hashTarget, readySections]);

  return (
    <div className="relative h-screen w-full">
      <NavBar mobileHidden={sandActive} />
      <div id="home"><Hero onDrawModeChange={setSandActive}/></div>
      <LazySection
        id="skills"
        forceVisible={hashSectionIndex >= 0}
        onReady={handleSectionReady}
      >
        <About/>
      </LazySection>
      <LazySection
        id="projects"
        forceVisible={hashSectionIndex >= 1}
        onReady={handleSectionReady}
      >
        <TileGrid/>
      </LazySection>
      <LazySection
        id="contact"
        minHeight="50svh"
        forceVisible={hashSectionIndex >= 2}
        onReady={handleSectionReady}
      >
        <Contact/>
      </LazySection>
    </div>
  );
};

export default App;
