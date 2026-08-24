import { createCookieSessionStorage } from '@remix-run/cloudflare'

export const { getSession, commitSession, destroySession } =
	createCookieSessionStorage({
		// a Cookie from `createCookie` or the same CookieOptions to create one
		cookie: {
			name: '__session',
			secrets: ['oooOOooOOoOOoOOOOoo'],
			// Lax, not Strict: members arrive via a redirect from the member app
			// (a different site), and a Strict cookie is withheld on that cross-
			// site-initiated navigation — so the username we set on entry would be
			// lost and the room would wrongly prompt for a name. Lax rides the
			// top-level redirect, so the name carries through.
			sameSite: 'lax',
			httpOnly: true,
		},
	})
