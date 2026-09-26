import { parentPort } from "node:worker_threads";
import { discoverMachine } from "./machine-discovery.mjs";
parentPort.postMessage(discoverMachine());
