// Gate for the Crown & Compass meeting app.
//
// Members reach a room only by clicking "Join the call" in the C&C app, which
// mints a short-lived signed token (see app-crownandcompass/src/lib/meet.ts).
// Here we VERIFY that token, then issue a room-scoped access GRANT cookie so
// that re-entry (after the display-name step, or on reload) does not need the
// one-time token again.
//
// Both the token and the grant are HMAC-SHA256 signed with MEET_SHARED_SECRET.
// This is deliberately NOT the Remix session secret: the upstream demo ships a
// public placeholder session secret, so anything guarding access must rest on a
// real secret instead. Web Crypto is provided by the Workers runtime.

export interface MeetClaims {
	member_id: number
	watch_id: number
	display_name: string
	room: string
	exp: number
}

export const MEET_ACCESS_COOKIE = 'cc_meet_access'

const enc = new TextEncoder()

function b64urlEncode(bytes: Uint8Array): string {
	let bin = ''
	for (const b of bytes) bin += String.fromCharCode(b)
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Uint8Array {
	const norm = s.replace(/-/g, '+').replace(/_/g, '/')
	const pad = norm.length % 4 ? 4 - (norm.length % 4) : 0
	const bin = atob(norm + '='.repeat(pad))
	const out = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
	return out
}

async function hmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		enc.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	)
}

// Sign a base64url body, returning "body.sig".
async function sign(secret: string, body: string): Promise<string> {
	const key = await hmacKey(secret)
	const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)))
	return `${body}.${b64urlEncode(sig)}`
}

// Verify a "body.sig" string; return the body if the signature is valid.
async function openSigned(secret: string, token: string): Promise<string | null> {
	const parts = (token || '').split('.')
	if (parts.length !== 2) return null
	const [body, sig] = parts
	const key = await hmacKey(secret)
	let ok = false
	try {
		ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(sig) as BufferSource, enc.encode(body))
	} catch {
		return null
	}
	return ok ? body : null
}

/** Verify the one-time ?t= join token from the member app. */
export async function verifyMeetToken(secret: string, token: string): Promise<MeetClaims | null> {
	const body = await openSigned(secret, token)
	if (!body) return null
	let c: MeetClaims
	try {
		c = JSON.parse(new TextDecoder().decode(b64urlDecode(body)))
	} catch {
		return null
	}
	if (!c || typeof c.exp !== 'number' || typeof c.room !== 'string') return null
	if (c.exp * 1000 < Date.now()) return null
	return c
}

/** Mint a room-scoped access grant (cookie value). */
export async function mintRoomGrant(secret: string, room: string, ttlSec: number): Promise<string> {
	const payload = { room, exp: Math.floor(Date.now() / 1000) + ttlSec }
	return sign(secret, b64urlEncode(enc.encode(JSON.stringify(payload))))
}

/** Verify a room-access grant cookie value. */
export async function verifyRoomGrant(
	secret: string,
	value: string
): Promise<{ room: string; exp: number } | null> {
	const body = await openSigned(secret, value)
	if (!body) return null
	let p: { room: string; exp: number }
	try {
		p = JSON.parse(new TextDecoder().decode(b64urlDecode(body)))
	} catch {
		return null
	}
	if (!p || typeof p.exp !== 'number' || typeof p.room !== 'string') return null
	if (p.exp * 1000 < Date.now()) return null
	return p
}

/** Read one cookie value out of a Cookie header. */
export function parseCookie(header: string | null, name: string): string | null {
	if (!header) return null
	for (const part of header.split(/;\s*/)) {
		const eq = part.indexOf('=')
		if (eq > -1 && part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1))
	}
	return null
}
