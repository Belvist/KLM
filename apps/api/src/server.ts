import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGateway } from "./gateway.js";

config({
  path: join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env"),
});

const PORT = Number(process.env.KLM_PORT ?? 3100);
const HOST = process.env.KLM_HOST ?? "0.0.0.0";

const { app } = await buildGateway({ logger: true });

await app.listen({ port: PORT, host: HOST });
console.log(`KLM Gateway listening on http://${HOST}:${PORT}`);
console.log(
  `Store: ${process.env.DATABASE_URL ? "postgres" : (process.env.KLM_STATE_PATH ?? ".klm-data")}`
);
