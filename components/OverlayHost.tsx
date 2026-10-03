'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { useUi, ui, type Overlay } from '@/lib/store/ui';
import BigText from './overlays/BigText';
import PhotoViewer from './overlays/PhotoViewer';
import SearchOverlay from './overlays/SearchOverlay';

// Heavier screens load on first use.
const CameraGuide = dynamic(() => import('./overlays/CameraGuide'), { ssr: false, loading: () => <div className="cam" aria-busy="true" /> });
const LiveSession = dynamic(() => import('./overlays/LiveSession'), { ssr: false, loading: () => <div className="cam" aria-busy="true" /> });
const BookingSheet = dynamic(() => import('./overlays/BookingSheet'), { ssr: false });
const ReservationForm = dynamic(() => import('./overlays/ReservationForm'), { ssr: false });
const TripForm = dynamic(() => import('./overlays/TripForm'), { ssr: false });
const StopEdit = dynamic(() => import('./overlays/StopEdit'), { ssr: false });
const Onboarding = dynamic(() => import('./overlays/Onboarding'), { ssr: false });
const ImportTrip = dynamic(() => import('./overlays/ImportTrip'), { ssr: false });

function OverlayView({ o }: { o: Overlay }) {
  switch (o.type) {
    case 'search': return <SearchOverlay pick={o.pick} initial={o.initial} voice={o.voice} />;
    case 'camera': return <CameraGuide />;
    case 'live': return <LiveSession />;
    case 'bigtext': return <BigText ja={o.ja} ko={o.ko} addr={o.addr} lead={o.lead} />;
    case 'booking': return <BookingSheet placeId={o.placeId} />;
    case 'resForm': return <ReservationForm id={o.id} prefill={o.prefill} />;
    case 'tripForm': return <TripForm id={o.id} />;
    case 'stopEdit': return <StopEdit tripId={o.tripId} date={o.date} stopId={o.stopId} />;
    case 'onboarding': return <Onboarding />;
    case 'photo': return <PhotoViewer src={o.src} caption={o.caption} />;
    case 'import': return <ImportTrip token={o.token} />;
    default: return null;
  }
}

export default function OverlayHost() {
  const overlays = useUi(s => s.overlays);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !ui().overlays.length) return;
      e.preventDefault();
      ui().close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return <>{overlays.map(o => <OverlayView key={o.type} o={o} />)}</>;
}
