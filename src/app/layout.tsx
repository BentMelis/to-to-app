import type { Metadata, Viewport } from 'next';
// Fonts are self-hosted (bundled from npm): works offline as a PWA and sends nothing to Google.
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import '@fontsource/bricolage-grotesque/latin-600.css';
import '@fontsource/bricolage-grotesque/latin-700.css';
import { ServiceWorker } from '@/components/ServiceWorker';
import { ConsentBanner } from '@/components/ConsentBanner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Todo tree',
  description: 'A todo list shaped like a tree: projects branch into sub-projects, todos and notes.',
  applicationName: 'Todo tree',
  appleWebApp: { capable: true, title: 'Todo tree', statusBarStyle: 'default' },
  icons: {
    icon: [{ url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' }],
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#EDF0E8' },
    { media: '(prefers-color-scheme: dark)', color: '#111713' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorker />
        <ConsentBanner />
      </body>
    </html>
  );
}
