export type Env = {
	rooms: DurableObjectNamespace
	CALLS_APP_ID: string
	CALLS_APP_SECRET: string
	CALLS_API_URL?: string
	DISABLE_LOBBY_ENFORCEMENT?: string
	E2EE_ENABLED?: string
	USER_DIRECTORY_URL?: string
	FEEDBACK_URL?: string
	FEEDBACK_QUEUE?: Queue
	FEEDBACK_STORAGE?: KVNamespace
	TURN_SERVICE_ID?: string
	TURN_SERVICE_TOKEN?: string
	TRACE_LINK?: string
	API_EXTRA_PARAMS?: string
	MAX_WEBCAM_FRAMERATE?: string
	MAX_WEBCAM_BITRATE?: string
	MAX_WEBCAM_QUALITY_LEVEL?: string
	EXPERIMENTAL_SIMULCAST_ENABLED?: string
	MAX_API_HISTORY?: string
	DB?: D1Database
	OPENAI_API_TOKEN?: string
	OPENAI_MODEL_ENDPOINT?: string
	OPENAI_MODEL_ID?: string
	DASHBOARD_WORKER_URL?: string
	// Crown & Compass gate. The worker holds NO signing secret: it POSTs each
	// token to APP_VERIFY_URL (the member app's /api/meet/verify) for validation.
	// When APP_VERIFY_URL is set, /watch-<id> rooms require a valid token/grant.
	// MEET_DENY_REDIRECT is where a denied visitor is sent (the member app).
	APP_VERIFY_URL?: string
	MEET_DENY_REDIRECT?: string
}
