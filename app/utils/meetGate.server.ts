// The Crown & Compass room gate, kept entirely server-side.
//
// This lives in a `.server.ts` module on purpose: it pulls in ~/session, which
// calls createCookieSessionStorage (a server-only Remix API). root.tsx runs on
// the client too, so importing that session code into root.tsx directly would
// bundle a server-only function into the client and crash hydration (blank
// room). A `.server` module is stripped from the client bundle, imports and all.

import { redirect } from '@remix-run/cloudflare';
import type { Env } from '../types/Env';
import { commitSession, getSession } from '../session';
import {
  MEET_ACCESS_COOKIE,
  mintRoomGrant,
  parseCookie,
  verifyMeetToken,
  verifyRoomGrant,
} from './meetToken.server';

// Returns a Response to throw (a redirect) when the request should be
// intercepted, or null to let it through. Only /watch-<id> paths are gated, and
// only when MEET_SHARED_SECRET is set (unset = the upstream demo behaviour).
export async function meetGate(request: Request, env: Env): Promise<Response | null> {
  const meetSecret = env.MEET_SHARED_SECRET;
  const url = new URL(request.url);
  const roomMatch = url.pathname.match(/^\/(watch-[^/]+)(?:\/.*)?$/);
  if (!meetSecret || !roomMatch) return null;

  const room = roomMatch[1];
  const deny = env.MEET_DENY_REDIRECT || 'https://app.thecrownandcompass.org';
  const t = url.searchParams.get('t');
  const claims = t ? await verifyMeetToken(meetSecret, t) : null;

  if (claims && claims.room === room) {
    // Fresh valid token: set the member's display name, grant room access for
    // 3 hours, and strip the one-time token from the URL with one redirect.
    const session = await getSession(request.headers.get('Cookie'));
    session.set('username', claims.display_name);
    const ttl = 3 * 60 * 60;
    const grant = await mintRoomGrant(meetSecret, room, ttl);
    const secure = url.protocol === 'https:';
    const headers = new Headers();
    headers.append('Set-Cookie', await commitSession(session));
    headers.append(
      'Set-Cookie',
      `${MEET_ACCESS_COOKIE}=${grant}; Path=/; Max-Age=${ttl}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
    );
    url.searchParams.delete('t');
    return redirect(url.pathname + url.search, { headers });
  }

  const cookie = parseCookie(request.headers.get('Cookie'), MEET_ACCESS_COOKIE);
  const grant = cookie ? await verifyRoomGrant(meetSecret, cookie) : null;
  if (!grant || grant.room !== room) {
    return redirect(deny);
  }
  return null;
}
