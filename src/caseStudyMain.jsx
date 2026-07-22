import { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import FallingSandCaseStudy from './FallingSandCaseStudy';
import './index.css';
import './FallingSandCaseStudy.css';
import './ProjectArt.css';

function BootSignal() {
  useEffect(() => {
    window.dispatchEvent(new Event('portfolio:booted'));
  }, []);
  return null;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <>
    <FallingSandCaseStudy />
    <BootSignal />
  </>,
);
