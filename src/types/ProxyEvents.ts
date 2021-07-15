import { ChatMessage } from "./ChatMessage"

export interface ProxyEvents {
	client_end: () => void
	client_error: (err: Error) => void
	remote_end: () => void
	remote_error: (err: Error) => void
	player_join: (uuid: string, username: string) => void
	player_leave: (uuid: string, username: string) => void
	chat: (message: ChatMessage) => void
}