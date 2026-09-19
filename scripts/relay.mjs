/* Standalone LAN relay for pages opened from file:// or any other origin.
   Usage: node scripts/relay.mjs [--port 3101]
   The fight page connects to it via ?relay=ws://<lan-ip>:3101. */
import { createRelayServer } from './ws-relay.mjs';
const args = process.argv.slice(2), at = args.indexOf('--port');
const port = at < 0 ? 3101 : Number(args[at + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be between 1024 and 65535.');
createRelayServer({ port });
