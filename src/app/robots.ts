import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    // The app itself has nothing to index (everything is in the visitor's browser); only the landing page.
    rules: { userAgent: '*', allow: '/', disallow: '/app' },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
