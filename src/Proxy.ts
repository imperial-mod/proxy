import EventEmitter from "events"
import TypedEmitter from "typed-emitter"
import * as mc from "minecraft-protocol"
import { Player } from "./types/Player"
import { ProxyEvents } from "./types/ProxyEvents"
import { ChatMessage } from "./types/ChatMessage"

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
		"chat"
	]
	private packetsToParseClient = ["chat"]

	private targetClient: mc.Client
	private srv: mc.Server
	private endedTargetClient = false
	private endedClient = false
	private client: mc.Client

	private players: Map<string, Player> = new Map<string, Player>()
	private uuidToId: Map<string, number> = new Map<string, number>()
	private idToUuid: Map<number, string> = new Map<number, string>()

	private emitJoin: boolean = false

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
			console.log(`Connected to proxy`)
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
			client.on("raw", async (raw, meta) => {
				if (meta.state == states.PLAY && this.targetClient.state == states.PLAY) {
					if (!this.endedTargetClient) {
						if (this.packetsToParseClient.includes(meta.name)) {
							const packet = (client as any).deserializer.parsePacketBuffer(raw).data.params
							if (meta.name == "chat") {
								if (packet.message.trim() == "/list") {
									let string = `\u00A77Online (\u00A7b${this.players.size}\u00A77): `
									for (const [key, value] of this.players) {
										string += `\u00A7a${value.username} `
									}
									client.write("chat", { message: JSON.stringify({ text: string }), position: 0 })
									return
								}
							}
						}

						this.targetClient.writeRaw(raw)
					}
				}
			})
			this.targetClient.on("raw", async (raw, meta) => {
				if (meta.state == states.PLAY && client.state == states.PLAY) {
					if (!this.endedClient) {
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
											this.emit("player_join", uuid, username)
										}
									}, 4)
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
								this.emit("chat", (JSON.parse(packet.message) as ChatMessage))
							} else if (meta.name == "scoreboard_objective") {
								if (packet.action == 0) {
									this.emitJoin = packet.name == "PreScoreboard"
									if (!this.emitJoin) {
										this.players.clear()
									}
								}
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
					console.log(`Proxy ready`)
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
}