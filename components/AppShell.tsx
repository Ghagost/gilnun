'use client';

import dynamic from 'next/dynamic';
import { BrandMark } from './Icons';

function Splash() {
  return (
    <div className="splash" role="status" aria-live="polite">
      <div className="logo"><BrandMark size={46} /></div>
      <div>길눈을 여는 중…</div>
    </div>
  );
}

// The app uses window APIs (GPS, camera, maps) everywhere, so it renders on the client only.
const App = dynamic(() => import('./App'), { ssr: false, loading: Splash });

export default function AppShell() {
  return <App />;
}
