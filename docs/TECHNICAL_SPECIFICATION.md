# Technical Specification

## Stack
Next.js, React, NestJS, TypeScript strict, PostgreSQL, pgvector, Drizzle ORM, Redis, BullMQ and Zod.

## Runtime boundaries
The browser calls the NestJS API. The API validates requests, authenticates the caller, resolves workspace membership, applies authorization, and accesses PostgreSQL through repositories.

## Initial delivery
Foundation scaffold, responsive dashboard shell, API health endpoint, shared domain contracts, initial relational schema and local PostgreSQL/Redis services.

## Deferred
Production authentication, RLS policies, ingestion workers, connectors, AI extraction, semantic retrieval, billing and mobile/desktop clients.
