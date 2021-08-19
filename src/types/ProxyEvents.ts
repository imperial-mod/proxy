import { ChatMessage } from "./ChatMessage"
import { Location } from "./Location"

export interface ProxyEvents {
	client_end: () => void
	client_error: (err: Error) => void
	remote_end: () => void
	remote_error: (err: Error) => void
	player_join: (uuid: string, username: string, bot?: boolean) => void
	player_leave: (uuid: string, username: string) => void
	connected_remote: () => void
	connected_local: () => void
	chat: (message: ChatMessage) => void
	location: (location: Location) => void
}