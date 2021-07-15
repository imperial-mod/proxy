### Hypixel Proxy

Open source proxy for Hypixel

#### Usage

Install the package with

`npm i hypixel-proxy -s`

#### Example

```js
const Proxy = require("hypixel-proxy")

const proxy = new Proxy(25566, "mojang")

proxy.startProxy()
proxy.on("player_join", (uuid, username) => {
	console.log(uuid, username)
})
```