import { NextResponse } from 'next/server';
import { runAgent } from '@/lib/agent';
import { listPendingUploads, listVideos } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST() {
  const result = await runAgent();
  return NextResponse.json(result);
}

export async function GET() {
  const [pending, recent] = await Promise.all([listPendingUploads(), listVideos(50)]);
  return NextResponse.json({
    pending,
    recent,
  });
}
