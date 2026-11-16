import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import express from "express";
import { toNodeHandler } from "better-auth/node";
import { AppModule } from "./app.module.js";
import { auth } from "./auth/auth.js";

async function bootstrap() {
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    cors: {
      origin: webOrigin,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    },
  });

  app.getHttpAdapter().getInstance().all("/api/auth/*splat", toNodeHandler(auth));
  app.use(express.json());
  app.setGlobalPrefix("api");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
  console.log(`MEMORA API listening on http://localhost:${port}/api`);
}
void bootstrap();
