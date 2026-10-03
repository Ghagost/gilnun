import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '길눈 — 일본 여행 지도 + AI',
  description: '구글 지도 기반 일본 여행 길잡이. ChatGPT·Claude·Gemini AI, 실시간 카메라 길안내, 일정·예약, 회화·통역까지.',
  applicationName: '길눈',
  manifest: '/manifest.webmanifest',
  icons: { icon: [{ url: '/favicon.ico', sizes: 'any' }, { url: '/icon-192.png', sizes: '192x192', type: 'image/png' }], apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }] },
  appleWebApp: { capable: true, title: '길눈', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#FFFFFF' }, { media: '(prefers-color-scheme: dark)', color: '#17191D' }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <link rel="stylesheet" href="/fonts/pretendard/pretendard.css" />
        <script
          // Applies the saved theme before first paint to avoid a light flash in dark mode.
          dangerouslySetInnerHTML={{ __html: `try{var s=JSON.parse(localStorage.getItem('gilnun.settings')||'{}');var t=s&&s.state&&s.state.theme;if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}` }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
