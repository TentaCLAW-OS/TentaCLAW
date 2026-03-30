#!/usr/bin/env node
/**
 * CLAWHub Registry — Entry Point
 *
 * Starts the CLAWHub package marketplace server.
 *
 * CLAWtopus says: "Every tentacle deserves the right tool."
 */

import { serve } from '@hono/node-server';
import { createRegistry } from './registry';

const PORT = parseInt(process.env.CLAWHUB_PORT || '3200', 10);
const HOST = process.env.CLAWHUB_HOST || '0.0.0.0';

const app = createRegistry();

console.log(`
\x1b[36m   _____ _       ___        ___  __    __  _
  / ____| |     / \\ \\      / / / / /  / / | |
 | |    | |    / _ \\ \\ /\\ / / /_/ /  / /  | |__
 | |    | |   / ___ \\ V  V / __  /  / /   | '_ \\
 | |____| |__/ /   \\_\\_/\\_/_/ /_/  / /    | |_) |
  \\_____|____/          Hub      /_/     |_.__/ \x1b[0m

\x1b[2m  The TentaCLAW Package Marketplace\x1b[0m
`);

serve({
    fetch: app.fetch,
    port: PORT,
    hostname: HOST,
}, (info) => {
    console.log(`[clawhub] Registry listening on http://${HOST}:${info.port}`);
    console.log(`[clawhub] API: http://${HOST}:${info.port}/v1/packages`);
    console.log(`[clawhub] Health: http://${HOST}:${info.port}/health`);
});
