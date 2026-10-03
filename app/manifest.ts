import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '길눈 — 일본 여행 지도 + AI',
    short_name: '길눈',
    description: '구글 지도 기반 일본 여행 길잡이 · AI · 카메라 길안내 · 일정 · 예약',
    lang: 'ko',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#15171A',
    theme_color: '#FFD21F',
    categories: ['travel', 'navigation'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'AI에게 묻기', url: '/?tab=ai', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
      { name: '카메라 길안내', url: '/?open=camera', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
      { name: '내 예약', url: '/?tab=booking', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
