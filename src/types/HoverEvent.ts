import { MessageComponent } from "./MessageComponent"

export interface HoverEvent {
	action: "show_text"
	value: string | MessageComponent
}