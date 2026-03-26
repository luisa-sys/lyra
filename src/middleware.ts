import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || '';

  const isProtectedHost =
    hostname.startsWith('dev.') ||
    hostname.startsWith('stage.') ||
    hostname.includes('.vercel.app');

  if (!isProtectedHost) {
    return NextResponse.next();
  }

  const validUser = process.env.BASIC_AUTH_USER || 'lyra';
  const validPass = process.env.BASIC_AUTH_PASSWORD;

  if (!validPass) {
    return NextResponse.next();
  }

  const authHeader = request.headers.get('authorization');

  if (authHeader) {
    const [scheme, encoded] = authHeader.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = atob(encoded);
      const [user, pass] = decoded.split(':');
      if (user === validUser && pass === validPass) {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Lyra Preview"',
    },
  });
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};