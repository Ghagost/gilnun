'use client';

import type { Panel } from '@/lib/store/ui';
import HomePanel from './panels/HomePanel';
import ResultsPanel from './panels/ResultsPanel';
import PlacePanel from './panels/PlacePanel';
import DirectionsPanel from './panels/DirectionsPanel';
import SavedPanel from './panels/SavedPanel';
import ChatPanel from './panels/ChatPanel';
import TripsPanel from './panels/TripsPanel';
import TripPanel from './panels/TripPanel';
import ReservationsPanel from './panels/ReservationsPanel';
import ReservationPanel from './panels/ReservationPanel';
import ToolsPanel from './panels/ToolsPanel';
import PhrasesPanel from './panels/PhrasesPanel';
import InterpreterPanel from './panels/InterpreterPanel';
import CurrencyPanel from './panels/CurrencyPanel';
import WeatherPanel from './panels/WeatherPanel';
import SafetyPanel from './panels/SafetyPanel';
import SettingsPanel from './panels/SettingsPanel';
import DiagnosticsPanel from './panels/DiagnosticsPanel';
import AboutPanel from './panels/AboutPanel';

export default function PanelHost({ panel }: { panel: Panel }) {
  switch (panel.type) {
    case 'home': return <HomePanel />;
    case 'results': return <ResultsPanel />;
    case 'place': return <PlacePanel key={panel.id} id={panel.id} />;
    case 'directions': return <DirectionsPanel key={`${panel.to.id}|${panel.mode || ''}`} to={panel.to} initialMode={panel.mode} />;
    case 'saved': return <SavedPanel />;
    case 'chat': return <ChatPanel />;
    case 'trips': return <TripsPanel />;
    case 'trip': return <TripPanel key={panel.id} id={panel.id} initialDay={panel.day} />;
    case 'reservations': return <ReservationsPanel />;
    case 'reservation': return <ReservationPanel key={panel.id} id={panel.id} />;
    case 'tools': return <ToolsPanel />;
    case 'phrases': return <PhrasesPanel />;
    case 'interpreter': return <InterpreterPanel />;
    case 'currency': return <CurrencyPanel />;
    case 'weather': return <WeatherPanel />;
    case 'safety': return <SafetyPanel />;
    case 'settings': return <SettingsPanel section={panel.section} />;
    case 'diagnostics': return <DiagnosticsPanel />;
    case 'about': return <AboutPanel />;
    default: return null;
  }
}
