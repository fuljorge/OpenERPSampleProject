import cookie from "@fastify/cookie";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

export default fp(async function cookiePlugin(fastify: FastifyInstance) {
  await fastify.register(cookie);
});
