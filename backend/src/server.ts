import "dotenv/config";
import { buildApp } from "./app.js";
import { connectMongo } from "./database/mongo.client.js";

async function bootstrap() {
  await connectMongo();
  const app = await buildApp();

  const port = Number(process.env.PORT ?? 3333);
  await app.listen({ port, host: "0.0.0.0" });
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
