import { ClickEvent } from "./ClickEvent"
import { HoverEvent } from "./HoverEvent"
import { MessageComponent } from "./MessageComponent"

export interface ChatMessage {
	text: string
	color?: string
	bold?: boolean
	strikethrough?: boolean
	obfuscated?: boolean
	underlined?: boolean
	italic?: boolean
	hoverEvent?: HoverEvent
	clickEvent?: ClickEvent
	extra: MessageComponent[]
}