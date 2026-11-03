import { connection } from 'next/server';
import { cloudConfigured } from '@/lib/server/config';

/** Whether accounts & sync are configured on this server (no secrets, no user data). Read per request, not at build. */
export async function GET() {
  await connection();
  return Response.json({ cloud: cloudConfigured() }, { headers: { 'cache-control': 'no-store' } });
}
