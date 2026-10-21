import type { Metadata } from 'next';
import TreesApp from '@/components/TreesApp';

export const metadata: Metadata = {
  title: 'TwigList',
  alternates: { canonical: '/app' },
};

export default function AppPage() {
  return <TreesApp />;
}
