import type { LoaderFunctionArgs } from '@remix-run/cloudflare'
import { json, redirect } from '@remix-run/cloudflare'
import { Outlet, useLoaderData, useParams } from '@remix-run/react'
import { commitSession, getSession } from '~/session'
import {
	MEET_ACCESS_COOKIE,
	mintRoomGrant,
	parseCookie,
	verifyMeetToken,
	verifyRoomGrant,
} from '~/utils/meetToken.server'
import { useObservableAsValue, useValueAsObservable } from 'partytracks/react'
import { useMemo, useState } from 'react'
import { of } from 'rxjs'
import invariant from 'tiny-invariant'
import { EnsureOnline } from '~/components/EnsureOnline'
import { EnsurePermissions } from '~/components/EnsurePermissions'
import { Icon } from '~/components/Icon/Icon'
import { Spinner } from '~/components/Spinner'

import { usePeerConnection } from '~/hooks/usePeerConnection'
import useRoom from '~/hooks/useRoom'
import { type RoomContextType } from '~/hooks/useRoomContext'
import { useRoomHistory } from '~/hooks/useRoomHistory'
import { useStablePojo } from '~/hooks/useStablePojo'
import useUserMedia from '~/hooks/useUserMedia'
import type { TrackObject } from '~/utils/callsTypes'
import { useE2EE } from '~/utils/e2ee'
import { getIceServers } from '~/utils/getIceServers.server'
import { mode } from '~/utils/mode'

function numberOrUndefined(value: unknown): number | undefined {
	const num = Number(value)
	return isNaN(num) ? undefined : num
}

function trackObjectToString(trackObject?: TrackObject) {
	if (!trackObject) return undefined
	return trackObject.sessionId + '/' + trackObject.trackName
}

export const loader = async ({ request, params, context }: LoaderFunctionArgs) => {
	// Crown & Compass gate. When MEET_SHARED_SECRET is set, a room is reachable
	// only with a valid one-time join token (?t=, minted by the member app) or a
	// still-valid access grant cookie from an earlier tokened entry. A fresh token
	// also sets the member's display name and is then stripped from the URL.
	const secret = context.env.MEET_SHARED_SECRET
	if (secret) {
		const roomName = params.roomName
		const deny = context.env.MEET_DENY_REDIRECT || 'https://app.thecrownandcompass.org'
		const url = new URL(request.url)
		const t = url.searchParams.get('t')
		const claims = t ? await verifyMeetToken(secret, t) : null
		if (claims && roomName && claims.room === roomName) {
			const session = await getSession(request.headers.get('Cookie'))
			session.set('username', claims.display_name)
			const ttl = 3 * 60 * 60
			const grant = await mintRoomGrant(secret, roomName, ttl)
			const secure = url.protocol === 'https:'
			const headers = new Headers()
			headers.append('Set-Cookie', await commitSession(session))
			headers.append(
				'Set-Cookie',
				`${MEET_ACCESS_COOKIE}=${grant}; Path=/; Max-Age=${ttl}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
			)
			url.searchParams.delete('t')
			throw redirect(url.pathname + url.search, { headers })
		}
		const cookie = parseCookie(request.headers.get('Cookie'), MEET_ACCESS_COOKIE)
		const grant = cookie ? await verifyRoomGrant(secret, cookie) : null
		if (!grant || !roomName || grant.room !== roomName) {
			throw redirect(deny)
		}
	}

	const {
		env: {
			TRACE_LINK,
			API_EXTRA_PARAMS,
			MAX_WEBCAM_FRAMERATE,
			MAX_WEBCAM_BITRATE,
			MAX_WEBCAM_QUALITY_LEVEL,
			MAX_API_HISTORY,
			EXPERIMENTAL_SIMULCAST_ENABLED,
		},
	} = context

	return json({
		userDirectoryUrl: context.env.USER_DIRECTORY_URL,
		traceLink: TRACE_LINK,
		apiExtraParams: API_EXTRA_PARAMS,
		iceServers: await getIceServers(context.env),
		feedbackEnabled: Boolean(
			context.env.FEEDBACK_URL &&
				context.env.FEEDBACK_QUEUE &&
				context.env.FEEDBACK_STORAGE
		),
		maxWebcamFramerate: numberOrUndefined(MAX_WEBCAM_FRAMERATE),
		maxWebcamBitrate: numberOrUndefined(MAX_WEBCAM_BITRATE),
		maxWebcamQualityLevel: numberOrUndefined(MAX_WEBCAM_QUALITY_LEVEL),
		maxApiHistory: numberOrUndefined(MAX_API_HISTORY),
		simulcastEnabled: EXPERIMENTAL_SIMULCAST_ENABLED === 'true',
		e2eeEnabled: context.env.E2EE_ENABLED === 'true',
	})
}

export default function RoomWithPermissions() {
	const [micDeviceId, setMicDeviceId] = useState<string>()
	const [cameraDeviceId, setCameraDeviceId] = useState<string>()
	return (
		<EnsurePermissions
			onCameraSelected={setCameraDeviceId}
			onMicSelected={setMicDeviceId}
		>
			<EnsureOnline
				fallback={
					<div className="grid h-full place-items-center">
						<div>
							<h1 className="flex items-center gap-3 text-3xl font-black">
								<Icon type="SignalSlashIcon" />
								You are offline
							</h1>
						</div>
					</div>
				}
			>
				<RoomPreparation
					micDeviceId={micDeviceId}
					cameraDeviceId={cameraDeviceId}
				/>
			</EnsureOnline>
		</EnsurePermissions>
	)
}

function RoomPreparation(props: {
	micDeviceId?: string
	cameraDeviceId?: string
}) {
	const { roomName } = useParams()
	invariant(roomName)
	const userMedia = useUserMedia(props)
	const room = useRoom({ roomName, userMedia })

	return room.roomState.meetingId ? (
		<Room room={room} userMedia={userMedia} />
	) : (
		<div className="grid place-items-center h-full">
			<Spinner className="text-gray-500" />
		</div>
	)
}

function tryToGetDimensions(videoStreamTrack?: MediaStreamTrack) {
	if (videoStreamTrack === undefined) {
		return { height: 0, width: 0 }
	}
	const height = videoStreamTrack?.getSettings().height ?? 0
	const width = videoStreamTrack?.getSettings().width ?? 0
	return { height, width }
}

interface RoomProps {
	room: ReturnType<typeof useRoom>
	userMedia: ReturnType<typeof useUserMedia>
}

function Room({ room, userMedia }: RoomProps) {
	const [joined, setJoined] = useState(false)
	const [dataSaverMode, setDataSaverMode] = useState(false)
	const [audioOnlyMode, setAudioOnlyMode] = useState(false)
	const { roomName } = useParams()
	invariant(roomName)

	const {
		userDirectoryUrl,
		traceLink,
		feedbackEnabled,
		apiExtraParams,
		iceServers,
		maxWebcamBitrate = 2_500_000,
		maxWebcamFramerate = 24,
		maxWebcamQualityLevel = 1080,
		maxApiHistory = 100,
		simulcastEnabled,
		e2eeEnabled,
	} = useLoaderData<typeof loader>()

	const params = new URLSearchParams(apiExtraParams)

	invariant(room.roomState.meetingId, 'Meeting ID cannot be missing')
	params.set('correlationId', room.roomState.meetingId)

	const { partyTracks, iceConnectionState } = usePeerConnection({
		maxApiHistory,
		apiExtraParams: params.toString(),
		iceServers,
	})
	const roomHistory = useRoomHistory(partyTracks, room)

	const scaleResolutionDownBy = useMemo(() => {
		if (dataSaverMode) return 4
		const videoStreamTrack = userMedia.videoStreamTrack
		const { height, width } = tryToGetDimensions(videoStreamTrack)
		// we need to do this in case camera is in portrait mode
		const smallestDimension = Math.min(height, width)
		return Math.max(smallestDimension / maxWebcamQualityLevel, 1)
	}, [maxWebcamQualityLevel, userMedia.videoStreamTrack, dataSaverMode])

	const sendEncodings = useStablePojo<RTCRtpEncodingParameters[]>(
		simulcastEnabled
			? [
					{
						rid: 'a',
						maxBitrate: 1_300_000,
						maxFramerate: 30.0,
						active: !dataSaverMode,
					},
					{
						rid: 'b',
						scaleResolutionDownBy: 2.0,
						maxBitrate: 500_000,
						maxFramerate: 24.0,
						active: true,
					},
				]
			: [
					{
						maxFramerate: maxWebcamFramerate,
						maxBitrate: maxWebcamBitrate,
						scaleResolutionDownBy,
					},
				]
	)
	const sendEncodings$ = useValueAsObservable(sendEncodings)

	const pushedVideoTrack$ = useMemo(
		() =>
			partyTracks.push(userMedia.videoTrack$, {
				sendEncodings$,
			}),
		[partyTracks, userMedia.videoTrack$, sendEncodings$]
	)

	const pushedVideoTrack = useObservableAsValue(pushedVideoTrack$)

	const pushedAudioTrack$ = useMemo(
		() =>
			partyTracks.push(userMedia.publicAudioTrack$, {
				sendEncodings$: of([{ networkPriority: 'high' }]),
			}),
		[partyTracks, userMedia.publicAudioTrack$]
	)
	const pushedAudioTrack = useObservableAsValue(pushedAudioTrack$)

	const pushedScreenSharingTrack$ = useMemo(
		() => partyTracks.push(userMedia.screenShareVideoTrack$),
		[partyTracks, userMedia.screenShareVideoTrack$]
	)
	const pushedScreenSharingTrack = useObservableAsValue(
		pushedScreenSharingTrack$
	)
	const [pinnedTileIds, setPinnedTileIds] = useState<string[]>([])
	const [showDebugInfo, setShowDebugInfo] = useState(mode !== 'production')

	const { e2eeSafetyNumber, onJoin } = useE2EE({
		enabled: e2eeEnabled,
		room,
		partyTracks,
	})

	const context: RoomContextType = {
		joined,
		setJoined,
		pinnedTileIds,
		setPinnedTileIds,
		showDebugInfo,
		setShowDebugInfo,
		dataSaverMode,
		setDataSaverMode,
		audioOnlyMode,
		setAudioOnlyMode,
		traceLink,
		userMedia,
		userDirectoryUrl,
		feedbackEnabled,
		partyTracks,
		roomHistory,
		e2eeSafetyNumber,
		e2eeOnJoin: onJoin,
		iceConnectionState,
		room,
		simulcastEnabled,
		pushedTracks: {
			video: trackObjectToString(pushedVideoTrack),
			audio: trackObjectToString(pushedAudioTrack),
			screenshare: trackObjectToString(pushedScreenSharingTrack),
		},
	}

	return <Outlet context={context} />
}
