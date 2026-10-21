import type { Metadata } from 'next';
import Landing from '@/components/landing/Landing';
import './landing.css';

export const metadata: Metadata = {
  title: 'TwigList: plan in branches, not in lists',
  description:
    'Lay your projects out as one tree, tick work off and watch it stack away, see deadlines coming, and walk into every meeting knowing what to ask. Free, in your browser, no account.',
  alternates: { canonical: '/' },
  openGraph: { type: 'website', siteName: 'TwigList', title: 'TwigList: plan in branches, not in lists', url: '/', locale: 'en' },
};

export default function Home() {
  return <Landing />;
}
