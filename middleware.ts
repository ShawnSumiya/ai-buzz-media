import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const BASIC_AUTH_USER = process.env.ADMIN_USER || 'admin';
const BASIC_AUTH_PASS = process.env.ADMIN_PASSWORD || 'demo1234';

export function middleware(request: NextRequest) {
  const authorization = request.headers.get('authorization');

  if (authorization) {
    const [scheme, encoded] = authorization.split(' ');

    if (scheme === 'Basic' && encoded) {
      try {
        const decoded = atob(encoded);
        const [user, pass] = decoded.split(':');

        if (user === BASIC_AUTH_USER && pass === BASIC_AUTH_PASS) {
          return NextResponse.next();
        }
      } catch {
        // デコード失敗時は認証エラーとして扱う
      }
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Admin Area"',
    },
  });
}

export const config = {
  matcher: ['/admin/:path*'],
};

