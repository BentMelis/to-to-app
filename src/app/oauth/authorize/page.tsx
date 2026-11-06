import type { Metadata } from 'next';
import Consent from './Consent';

export const metadata: Metadata = {
  title: 'Connect an app · TwigList',
  robots: { index: false, follow: false },
};

/** OAuth consent for MCP clients such as Claude. */
export default function AuthorizePage() {
  return <Consent />;
}
