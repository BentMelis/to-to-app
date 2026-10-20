import type { Metadata } from 'next';
import TreesApp from '@/components/TreesApp';

export const metadata: Metadata = {
  title: 'Todo Tree',
};

export default function AppPage() {
  return <TreesApp />;
}
