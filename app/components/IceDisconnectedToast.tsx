import Toast, { Root } from '~/components/Toast'
import { useConditionForAtLeast } from '~/hooks/useConditionForAtLeast'
import { useRoomContext } from '../hooks/useRoomContext'
import { Icon } from './Icon/Icon'

// Two different failures, deliberately worded differently.
//
// 'disconnected' means a connection that WAS working dropped — usually
// transient, and it often recovers on its own.
//
// 'failed' means ICE never negotiated a usable path. Nothing was ever connected
// and nothing recovers without a network change. That state was unhandled
// anywhere in this app, which is why the 2026-09-02 meeting could not be
// troubleshooted: a man whose media never connected still loaded the room and
// still saw everyone in the roster, because the roster arrives over a WebSocket
// on TLS 443 that works nearly everywhere. The call looked fine and was silent.
// Saying so on screen is the difference between "the meeting is broken" and
// "my network is blocking this call".
export function IceDisconnectedToast() {
	const { iceConnectionState } = useRoomContext()

	const disconnectedForAtLeastTwoSeconds = useConditionForAtLeast(
		iceConnectionState === 'disconnected',
		2000
	)

	// No grace period on 'failed': it is terminal, so waiting only prolongs the
	// silence the man is already sitting in.
	if (iceConnectionState === 'failed') {
		return (
			<Root duration={Infinity}>
				<div className="space-y-2 text-sm">
					<div className="font-bold">
						<Toast.Title className="flex items-center gap-2">
							<Icon type="WifiIcon" />
							No connection to the call
						</Toast.Title>
					</div>
					<Toast.Description>
						You are in the room, but audio and video cannot get through this
						network — others may still see you listed. Try a different network:
						a phone hotspot usually works, or rejoin off VPN or guest WiFi.
					</Toast.Description>
				</div>
			</Root>
		)
	}

	if (!disconnectedForAtLeastTwoSeconds) {
		return null
	}

	return (
		<Root duration={Infinity}>
			<div className="space-y-2 text-sm">
				<div className="font-bold">
					<Toast.Title className="flex items-center gap-2">
						<Icon type="WifiIcon" />
						ICE disconnected
					</Toast.Title>
				</div>
			</div>
		</Root>
	)
}
