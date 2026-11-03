import type { Metadata } from 'next';
import AppRoot from '@/components/AppRoot';

export const metadata: Metadata = {
  title: 'TwigList',
};

export default function AppPage() {
  return <AppRoot />;
}
