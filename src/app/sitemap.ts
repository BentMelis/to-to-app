import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  // Only the landing page: /app is kept out of search (see robots.ts).
  return [{ url: SITE_URL, changeFrequency: 'weekly', priority: 1 }];
}
