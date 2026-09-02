import type { LoaderFunctionArgs } from '@remix-run/cloudflare'
import { routePartyTracksRequest } from 'partytracks/server'

// NOTE ON TURN — read before touching this file.
//
// TWO independent paths decide a client's ICE servers, and BOTH must carry TURN
// or the call is STUN-only:
//
//   A. `getIceServers()` in the room loader (app/utils/getIceServers.server.ts),
//      which needs TURN_SERVICE_ID + TURN_SERVICE_TOKEN in the env.
//   B. this proxy. When the loader returns `undefined`, partytracks falls back
//      to fetching `/partytracks/generate-ice-servers` from here — and without
//      the two turnServer* fields below, the library's handler returns a
//      hardcoded `stun:stun.cloudflare.com` list and nothing else.
//
// Path B is the one that is easy to miss: fixing only the config would leave a
// silent STUN-only fallback in place and look like it had been fixed.
//
// Why it matters: media reaches the Realtime SFU over UDP. STUN alone works on
// a permissive home network and fails behind corporate/guest WiFi, symmetric
// NAT and CGNAT (common on phone hotspots). The room then splits — some men
// connect and hear each other, the rest join, appear in the roster over the
// WebSocket (TLS 443, always reachable) and get no audio in either direction.
// That is the 2026-09-02 meeting.
const proxy = async ({ request, context }: LoaderFunctionArgs) =>
	routePartyTracksRequest({
		appId: context.env.CALLS_APP_ID,
		token: context.env.CALLS_APP_SECRET,
		realtimeApiBaseUrl: context.env.CALLS_API_URL,
		// Undefined when TURN is not provisioned: degrades to the STUN-only
		// behaviour described above rather than breaking the call outright.
		turnServerAppId: context.env.TURN_SERVICE_ID,
		turnServerAppToken: context.env.TURN_SERVICE_TOKEN,
		request,
	})

export const loader = proxy
export const action = proxy
