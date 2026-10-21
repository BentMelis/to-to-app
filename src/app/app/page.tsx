import type { Metadata } from 'next';
import TreesApp from '@/components/TreesApp';

export const metadata: Metadata = {
  title: 'TwigList',
};

export default function AppPage() {
  return <TreesApp />;
}
