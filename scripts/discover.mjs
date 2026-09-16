import { discoverMachine } from "../server/machine-discovery.mjs";
const discovery = discoverMachine();
console.log(JSON.stringify(discovery, null, 2));
