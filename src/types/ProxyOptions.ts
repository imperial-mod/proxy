import { PathLike } from "fs";

export interface ProxyOptions {
	username: string,
	password?: string,
	profilesFolder?: PathLike,
	token?: string,
	port?: number
}