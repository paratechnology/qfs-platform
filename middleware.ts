import { NextRequest, NextResponse } from "next/server";

/**
 * Cheap cookie-presence guard for the private dashboard area.
 * Real session verification happens in server components / route handlers.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const headers = new Headers(req.headers);
  headers.set("x-qfs-path", pathname);
  if (pathname === "/user/user/login" && req.nextUrl.searchParams.get("next")?.startsWith("/user/admin")) {
    return NextResponse.redirect(new URL("/admin/login", req.url));
  }
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/user/admin");
  const isProtected =
    pathname.startsWith("/user/user/dashboard") || (isAdmin && pathname !== "/admin/login");

  // Public login/register pages always show their forms, including with a saved
  // session. Private layouts verify the session rather than trusting the cookie.
  if (isProtected && !req.cookies.get("qfs_session")?.value) {
    const url = req.nextUrl.clone();
    url.pathname = isAdmin ? "/admin/login" : "/user/user/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
