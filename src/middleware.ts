import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Vercel's built-in deployment protection handles auth for
  // preview/development deployments. This middleware is kept
  // as a placeholder for future route-level protection.
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};