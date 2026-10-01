import type { FastifyInstance } from "fastify";
import imageRoutes from "../routes/image.routes.js";

export default async function imageModule(fastify: FastifyInstance) {
  await fastify.register(imageRoutes, { prefix: "/api/images" });
}
