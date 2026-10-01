import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { addDropLink } from '@/lib/drops/feeds';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

/** POST /api/drops  { url, kind: 'online' | 'in-store', title?, date?: 'YYYY-MM-DD' } — add a link by hand. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { url?: unknown; kind?: unknown; title?: unknown; date?: unknown };
  if (typeof body.url !== 'string' || !body.url.trim() || body.url.length > 2048) {
    return NextResponse.json({ error: 'Paste a link first.' }, { status: 400 });
  }
  const kind = body.kind === 'in-store' ? 'in-store' : 'online';
  const date =
    typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? new Date(`${body.date}T12:00:00Z`) : undefined;
  try {
    const item = await addDropLink({
      url: body.url,
      kind,
      title: typeof body.title === 'string' ? body.title.slice(0, 300) : undefined,
      date,
    });
    revalidatePath(kind === 'in-store' ? '/in-store' : '/drops');
    return NextResponse.json({ ok: true, item });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Couldn’t add that link.' }, { status: 400 });
  }
}
