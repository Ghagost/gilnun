'use client';

import { useEffect, useRef } from 'react';
import { handleLaunchParams, loadConfig, loadFx, loadQuakes, loadWeather, registerSW, wireTransport } from '@/lib/boot';
import { startCompass, startGeo } from '@/lib/sensors';
import { useGeo } from '@/lib/store/geo';
import { runtime } from '@/lib/store/runtime';
import { useSettings, settings } from '@/lib/store/settings';
import { currentPanel, useUi, ui } from '@/lib/store/ui';
import { usePlaces } from '@/lib/store/places';
import { IconSprite } from './Icons';
import MapView from './MapView';
import TopBar from './TopBar';
import Sheet from './Sheet';
import { Banners, Fabs, TabBar, Toast } from './Chrome';
import OverlayHost from './OverlayHost';
import { useInterval, useWide } from './hooks';
import { useTripPins } from './panels/TripPanel';

wireTransport();

/** Android back / browser back: close overlays, then panels, then tabs — before leaving the app. */
function useBackNav() {
  const armed = useRef(false);
  useEffect(() => {
    const arm = () => { if (!armed.current) { history.pushState({ gilnun: 1 }, ''); armed.current = true; } };
    arm();
    let lastExitHint = 0;
    const onPop = () => {
      armed.current = false;
      const s = ui();
      let handled = true;
      if (s.overlays.length) s.close();
      else if (s.layersOpen) s.setLayers(false);
      else if (s.stacks[s.tab].length > 1) s.pop();
      else if (s.tab !== 'map') s.setTab('map');
      else if (s.sheet !== 'peek') { s.setSheet('peek'); usePlaces.getState().select(null); }
      else handled = false;
      if (handled) arm();
      else if (Date.now() - lastExitHint > 2500) {
        lastExitHint = Date.now();
        s.showToast('뒤로 버튼을 한 번 더 누르면 앱을 나가요');
        arm();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
}

function useTheme() {
  const theme = useSettings(s => s.theme);
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'auto') delete el.dataset.theme;
    else el.dataset.theme = theme;
  }, [theme]);
}

export default function App() {
  const tab = useUi(s => s.tab);
  const wide = useWide();
  const me = useGeo(s => s.me);
  useBackNav();
  useTheme();
  useTripPins();

  useEffect(() => {
    void loadConfig();
    startGeo();
    startCompass();
    void loadFx();
    void loadQuakes();
    registerSW();
    void handleLaunchParams();
    if (!settings().onboarded) ui().open({ type: 'onboarding' });
    const on = () => runtime().set({ online: true });
    const off = () => runtime().set({ online: false });
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const vis = () => { if (document.visibilityState === 'visible') { void loadQuakes(); void loadWeather(); } };
    document.addEventListener('visibilitychange', vis);
    const bip = (e: Event) => { e.preventDefault(); runtime().set({ installPrompt: e }); };
    window.addEventListener('beforeinstallprompt', bip);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('beforeinstallprompt', bip);
    };
  }, []);

  // Weather once we know where the user is.
  const haveMe = !!me;
  useEffect(() => { if (haveMe) void loadWeather(); }, [haveMe]);
  useInterval(() => { if (document.visibilityState === 'visible') void loadQuakes(); }, 3 * 60000);
  useInterval(() => { if (document.visibilityState === 'visible') void loadWeather(); }, 30 * 60000);

  const panelType = useUi(s => currentPanel(s).type);
  const showTop = wide || tab === 'map';

  return (
    <div className="app" data-tab={tab} data-panel={panelType}>
      <IconSprite />
      <MapView />
      {showTop && <TopBar />}
      <Fabs />
      <Sheet />
      <TabBar />
      <Banners />
      <OverlayHost />
      <Toast />
    </div>
  );
}
