# Technical Specification

## Stack
Next.js, React, NestJS, TypeScript strict, PostgreSQL, pgvector, Drizzle ORM, Redis, BullMQ and Zod.

## Runtime boundaries
The browser calls the NestJS API. The API validates requests, authenticates the caller, resolves workspace membership, applies authorization, and accesses PostgreSQL through repositories.

## Initial delivery
Foundation scaffold, responsive dashboard shell, API health endpoint, shared domain contracts, core relational schema, local PostgreSQL/Redis services, Better Auth signup/signin, email verification, password reset, database sessions, protected API routes and personal-workspace provisioning.

## Deferred
Workspace authorization and RLS policies, ingestion workers, connectors, AI extraction, semantic retrieval, billing and mobile/desktop clients.
