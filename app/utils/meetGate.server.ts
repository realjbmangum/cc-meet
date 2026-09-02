// The Crown & Compass room gate, kept entirely server-side.
//
// This worker holds NO signing secret. It forwards each token to the member
// app's /api/meet/verify endpoint, which validates it and (for a fresh join
// token) returns a longer-lived grant token to set as a cookie. That removes the
// two-secrets-in-sync failure mode entirely: only the app knows the secret, so
// this worker can be redeployed and reskinned freely without breaking anything.
//
// Lives in a `.server` module so its session code never reaches the client
// bundle (importing createCookieSessionStorage into the client crashes it).

import { redirect } from '@remix-run/cloudflare';
import type { Env } from '../types/Env';
import { commitSession, getSession } from '../session';
import { MEET_ACCESS_COOKIE, parseCookie } from './meetToken.server';

interface VerifyResult {
  valid: boolean;
  claims?: { member_id: number; watch_id: number; display_name: string; room: string };
  grant?: string;
}

// Ask the member app whether a token is valid. Returns {valid:false} on any
// error so a failure fails closed (denied), never open.
async function verifyViaApp(verifyUrl: string, token: string): Promise<VerifyResult> {
  try {
    const r = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!r.ok) return { valid: false };
    return (await r.json()) as VerifyResult;
  } catch {
    return { valid: false };
  }
}

// Returns a Response to throw (a redirect) when the request should be
// intercepted, or null to let it through. Only /watch-<id> paths are gated, and
// only when APP_VERIFY_URL is set (unset = the upstream demo behaviour).
export async function meetGate(request: Request, env: Env): Promise<Response | null> {
  const verifyUrl = env.APP_VERIFY_URL;
  const url = new URL(request.url);
  const roomMatch = url.pathname.match(/^\/(watch-[^/]+)(?:\/.*)?$/);
  if (!verifyUrl || !roomMatch) return null;

  const room = roomMatch[1];
  const deny = env.MEET_DENY_REDIRECT || 'https://app.thecrownandcompass.org';

  // A fresh one-time join token arrives as ?t=. Validate it with the app; on
  // success set the display name + a grant cookie and strip the token.
  const t = url.searchParams.get('t');
  if (t) {
    const res = await verifyViaApp(verifyUrl, t);
    if (res.valid && res.claims && res.claims.room === room && res.grant) {
      const session = await getSession(request.headers.get('Cookie'));
      session.set('username', res.claims.display_name);
      const secure = url.protocol === 'https:';
      const headers = new Headers();
      headers.append('Set-Cookie', await commitSession(session));
      headers.append(
        'Set-Cookie',
        `${MEET_ACCESS_COOKIE}=${res.grant}; Path=/; Max-Age=${3 * 60 * 60}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
      );
      url.searchParams.delete('t');
      return redirect(url.pathname + url.search, { headers });
    }
    // Invalid/expired token: fall through to the grant check, then deny.
  }

  // Re-entry (reload, lobby -> room) carries the grant cookie instead. The app
  // verifies it the same way (it is just a longer-lived token we minted).
  const grantCookie = parseCookie(request.headers.get('Cookie'), MEET_ACCESS_COOKIE);
  if (grantCookie) {
    const res = await verifyViaApp(verifyUrl, grantCookie);
    if (res.valid && res.claims && res.claims.room === room) return null;
  }

  return redirect(deny);
}
