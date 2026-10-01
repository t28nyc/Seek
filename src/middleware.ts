import { NextResponse, type NextRequest } from 'next/server';

/**
 * Optional password for the whole site. Set SITE_PASSWORD in Vercel → Settings → Environment Variables
 * to turn it on (any username works). Scheduled jobs (/api/cron/*) use CRON_SECRET instead, so the
 * GitHub schedule keeps working. With SITE_PASSWORD unset, the site stays open.
 */
export function middleware(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password || req.nextUrl.pathname.startsWith('/api/cron/')) return NextResponse.next();

  const auth = req.headers.get('authorization') ?? '';
  if (auth.startsWith('Basic ')) {
    try {
      const [, given] = atob(auth.slice(6)).split(/:(.*)/s);
      if (given === password) return NextResponse.next();
    } catch {
      /* bad header */
    }
  }
  return new NextResponse('Password required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Seek", charset="UTF-8"' },
  });
}

export const config = {
  // Everything except Next's static files
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
