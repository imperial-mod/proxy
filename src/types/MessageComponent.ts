import { ClickEvent } from "./ClickEvent"
import { HoverEvent } from "./HoverEvent"

export interface MessageComponent {
	text: string
	color?: string
	bold?: boolean
	strikethrough?: boolean
	obfuscated?: boolean
	underlined?: boolean
	italic?: boolean
	hoverEvent?: HoverEvent
	clickEvent?: ClickEvent
}