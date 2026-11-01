// File: src/middleware.ts

import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, verifyAdminToken } from "@/lib/auth";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  const verifiedAdmin = await verifyAdminToken(token);

  // 1. If the user is visiting /admin/login
  if (pathname.startsWith("/admin/login")) {
    // If already logged in, redirect straight to /admin
    if (verifiedAdmin) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    return NextResponse.next();
  }

  // 2. For all other /admin routes, require a valid 24h JWT token
  if (!verifiedAdmin) {
    const loginUrl = new URL("/admin/login", request.url);
    const response = NextResponse.redirect(loginUrl);
    if (token) {
      response.cookies.delete(ADMIN_COOKIE_NAME);
    }
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
