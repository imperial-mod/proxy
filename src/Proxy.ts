import EventEmitter from "events"
import TypedEmitter from "typed-emitter"
import * as mc from "minecraft-protocol"
import { Player } from "./types/Player"
import { ProxyEvents } from "./types/ProxyEvents"
import { ChatMessage } from "./types/ChatMessage"
import { Location } from "./types/Location"

export class Proxy extends (EventEmitter as new () => TypedEmitter<ProxyEvents>) {
	private port: number
	private auth: "microsoft" | "mojang"
	private packetsToParseServer = [
		"named_entity_spawn",
		"player_info",
		"entity_destroy",
		"login",
		"scoreboard_objective",
		"scoreboard_score",
		"scoreboard_display_objective",
		"scoreboard_team",
		"chat",
		"spawn_position"
	]
	private packetsToParseClient = ["chat"]

	private inboundPacketHandler: undefined | ((raw: Buffer, meta: mc.PacketMeta) => boolean | void)
	private outboundPacketHandler: undefined | ((raw: Buffer, meta: mc.PacketMeta) => boolean | void)

	private inboundListeners: Map<string, (packet: any, raw: Buffer) => boolean | void> = new Map<string, (packet: any, raw: Buffer) => boolean | void>()
	private outboundListeners: Map<string, (packet: any, raw: Buffer) => boolean | void> = new Map<string, (packet: any, raw: Buffer) => boolean | void>()

	public client: mc.Client
	public targetClient: mc.Client

	private srv: mc.Server
	private endedTargetClient = false
	private endedClient = false

	private players: Map<string, Player> = new Map<string, Player>()
	private uuidToId: Map<string, number> = new Map<string, number>()
	private idToUuid: Map<number, string> = new Map<number, string>()
	private commands: Map<string, Function> = new Map<string, Function>()
	private awaitingLocraw: boolean = false

	private bots: string[] = []

	private emitJoin: boolean = false

	public location: Location = { server: "limbo" }

	constructor(port?: number, auth?: "microsoft" | "mojang") {
		super()
		this.port = port || 25566
		this.auth = auth || "mojang"
	}

	public getPlayer = (uuid: string) => {
		return this.players.get(uuid)
	}

	public startProxy = () => {
		const states = mc.states
		this.srv = mc.createServer({
			"online-mode": true,
			"port": this.port,
			"keepAlive": false,
			"version": "1.8",
			"motd": "",
			"maxPlayers": 0
		})
		this.srv.on("login", (client) => {
			const addr = client.socket.remoteAddress
			this.emit("connected_local")
			this.endedClient = false
			this.endedTargetClient = false
			this.client = client

			client.on("end", () => {
				this.endedClient = true
				if (!this.endedTargetClient) {
					this.emit("client_end")
					this.targetClient.end("End")
				}
			})
			client.on("error", (err) => {
				this.endedClient = true
				if (!this.endedTargetClient) {
					this.emit("client_error", err)
					this.targetClient.end("Error")
				}
			})
			this.targetClient = mc.createClient(({
				host: "mc.hypixel.net",
				port: 25565,
				username: client.username,
				keepAlive: false,
				version: "1.8",
				profilesFolder: require("minecraft-folder-path"),
				auth: this.auth
			} as any))
			client.on("raw", async (raw: Buffer, meta: mc.PacketMeta) => {
				if (meta.state == states.PLAY && this.targetClient.state == states.PLAY) {
					if (!this.endedTargetClient) {
						if (this.outboundPacketHandler && await this.outboundPacketHandler(raw, meta)) return
						if (this.outboundListeners.get(meta.name)) {
							const cb = this.outboundListeners.get(meta.name)
							const packet = (client as any).deserializer.parsePacketBuffer(raw).data.params
							if (cb) {
								const result = cb(packet, raw)
								if (result) return
							}
						}
						if (this.packetsToParseClient.includes(meta.name)) {
							const packet = (client as any).deserializer.parsePacketBuffer(raw).data.params
							if (meta.name == "chat") {
								const args = (packet.message.trim().replace("/", "").split(" ") as string[])
								const commandName = args.shift()
								if (commandName && packet.message.startsWith("/") && this.commands.get(commandName)) {
									const cb = this.commands.get(commandName)
									if (cb)
										cb(...args)
									return
								}
							}
						}

						this.targetClient.writeRaw(raw)
					}
				}
			})
			this.targetClient.on("raw", async (raw: Buffer, meta: mc.PacketMeta) => {
				if (meta.state == states.PLAY && client.state == states.PLAY) {
					if (!this.endedClient) {
						if (this.inboundPacketHandler && await this.inboundPacketHandler(raw, meta)) return
						if (this.inboundListeners.get(meta.name)) {
							const cb = this.inboundListeners.get(meta.name)
							const packet = (this.targetClient as any).deserializer.parsePacketBuffer(raw).data.params
							if (cb) {
								const result = cb(packet, raw)
								if (result) return
							}
						}
						if (this.packetsToParseServer.includes(meta.name)) {
							const packet = (this.targetClient as any).deserializer.parsePacketBuffer(raw).data.params
							if (meta.name == "player_info") {
								if (packet.action == 0) {
									const uuid = packet.data[0].UUID
									const username = packet.data[0].name
									// hacky fix to prevent player join events from firing after the game starts
									setTimeout(() => {
										if (!this.players.get(uuid) && username && this.emitJoin) {
											this.players.set(uuid, {
												uuid,
												username
											})
											this.emit("player_join", uuid, username, this.bots.includes(username))
										}
									}, 16)
								}
							} else if (meta.name == "named_entity_spawn") {
								this.idToUuid.set(packet.entityId, packet.playerUUID)
								this.uuidToId.set(packet.playerUUID, packet.entityId)
							} else if (meta.name == "entity_destroy") {
								for (const id of packet.entityIds) {
									const uuid = this.idToUuid.get(id)
									if (uuid && this.emitJoin) {
										const player = this.players.get(uuid)

										this.players.delete(uuid)
										this.idToUuid.delete(id)
										this.uuidToId.delete(uuid)

										if (player)
											this.emit("player_leave", uuid, player.username)
									}
								}
							} else if (meta.name == "login") {
								//this.emit("player_join", this.client.uuid, this.client.username)
								for (const [key, value] of this.players.entries()) {
									this.emit("player_leave", value.uuid, value.username)
								}
								this.players.clear()
							} else if (meta.name == "chat") {
								const parsedMessage = (JSON.parse(packet.message) as ChatMessage)
								try {
									if (this.awaitingLocraw && parsedMessage.color == "white") {
										const locraw = (JSON.parse(parsedMessage.text) as Location)

										this.awaitingLocraw = false
										this.emit("location", locraw)

										return
									}
								} catch {

								}
								this.emit("chat", parsedMessage)
							} else if (meta.name == "scoreboard_objective") {
								if (packet.action == 0) {
									this.emitJoin = packet.name == "PreScoreboard"
									if (!this.emitJoin) {
										this.players.clear()
										this.bots.splice(0, this.bots.length)
									}
								}
							} else if (meta.name == "scoreboard_team" && this.emitJoin) {
								if (packet.players && packet.prefix) {
									if (packet.prefix == "§c"
										&& packet.color == 12
										&& packet.suffix == ""
										&& packet.mode == 0) {
										this.bots.push(packet.players[0])
									}
								}
							} else if (meta.name == "spawn_position") {
								this.awaitingLocraw = true
								this.targetClient.write("chat", { message: "/locraw" })
							}
						}

						client.writeRaw(raw)
					}
				}
			})
			this.targetClient.on("end", () => {
				this.endedTargetClient = true
				if (!this.endedClient) {
					this.emit("remote_end")
					client.end("End")
				}
			})
			this.targetClient.on("error", (err) => {
				this.endedTargetClient = true
				if (!this.endedClient) {
					this.emit("remote_error", err)
					client.end("Error")
				}
			})
			this.targetClient.on("state", (state) => {
				if (state == states.PLAY) {
					this.emit("connected_remote")
				}
			})
		})
	}

	public writeClient = (name: string, data: any) => {
		if (!this.endedClient) {
			this.client.write(name, data)
		}
	}

	public writeServer = (name: string, data: any) => {
		if (!this.endedTargetClient) {
			this.targetClient.write(name, data)
		}
	}

	public registerCommand = (name: string, handler: (...args: string[]) => {}) => {
		this.commands.set(name, handler)
	}

	public unregisterCommand = (name: string) => {
		if (this.commands.get(name)) {
			this.commands.delete(name)
		}
	}

	public handleInboundPacket = (name: string, handler: (packet: any, raw: Buffer) => boolean | void) => {
		this.inboundListeners.set(name, handler)
	}

	public handleOutboundPacket = (name: string, handler: (packet: any, raw: Buffer) => boolean | void) => {
		this.outboundListeners.set(name, handler)
	}

	public setInboundPacketHandler = (handler: (raw: Buffer, meta: mc.PacketMeta) => boolean | void) => {
		this.inboundPacketHandler = handler
	}

	public setOutboundPacketHandler = (handler: (raw: Buffer, meta: mc.PacketMeta) => boolean | void) => {
		this.outboundPacketHandler = handler
	}
}