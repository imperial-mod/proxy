export interface ClickEvent {
	action: "open_url" |  "run_command"
	value: string
}