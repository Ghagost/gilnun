import type { LatLng } from '../geo';
import type { RouteLine } from '../types';

export type Insets = { top: number; bottom: number; left: number; right: number };

export type MarkerSpec = {
  id: string;
  lat: number;
  lng: number;
  kind: 'place' | 'dest' | 'stop' | 'res';
  color: string;
  label?: string;
  icon?: string;
  title?: string;
  /** Short name drawn under the pin. */
  caption?: string;
  selected?: boolean;
  z?: number;
};

export type UserSpec = { lat: number; lng: number; acc: number; heading: number | null; stale?: boolean } | null;

export interface MapAdapter {
  readonly engine: 'google' | 'maplibre';
  getCenter(): LatLng;
  getZoom(): number;
  getHeading(): number;
  isTilted(): boolean;
  setInsets(i: Insets): void;
  /** Centre on a point inside the visible (non-covered) part of the map. */
  focus(p: LatLng, zoom?: number, animate?: boolean): void;
  fitPoints(points: LatLng[], maxZoom?: number): void;
  setMarkers(markers: MarkerSpec[]): void;
  setUser(u: UserSpec): void;
  setRoutes(lines: RouteLine[]): void;
  setTilt3D(on: boolean): void;
  /** Jump (no animation) to a centre / zoom / compass heading (heading-up minimap). */
  setCamera(c: { center: LatLng; zoom?: number; heading?: number }): void;
  resetNorth(): void;
  setLayer(layer: 'transit' | 'traffic', on: boolean): void;
  onMarkerClick(cb: (id: string) => void): void;
  onGesture(cb: () => void): void;
  /** Google only: tap on a basemap point of interest. */
  onPoiClick(cb: (placeId: string, at: LatLng) => void): void;
  onMapClick(cb: (at: LatLng) => void): void;
  onCamera(cb: () => void): void;
  resize(): void;
  destroy(): void;
}
