import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import NavBar from './NavBar';
import Hero from './Hero';
import './Portfolio.css';

const About = lazy(() => import('./About'));
const TileGrid = lazy(() => import('./TileGrid'));
const Contact = lazy(() => import('./Contact'));

function LazySection({ id, minHeight = '100svh', children }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.location.hash === `#${id}`;
  });

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
      {visible ? <Suspense fallback={null}>{children}</Suspense> : null}
    </div>
  );
}

const App = () => {
  return (
    <div className="relative h-screen w-full">
      <NavBar />
      <div id="home"><Hero/></div>
      <LazySection id="skills"><About/></LazySection>
      <LazySection id="projects"><TileGrid/></LazySection>
      <LazySection id="contact" minHeight="50svh"><Contact/></LazySection>
    </div>
  );
};

export default App;
