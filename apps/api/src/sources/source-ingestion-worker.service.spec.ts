import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SourceIngestionWorkerService } from "./source-ingestion-worker.service.js";

interface MockLogger {
  warn: (...args: unknown[]) => void;
  log?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

function createIsolatedWorker(pool: unknown, logger?: MockLogger): SourceIngestionWorkerService {
  const worker = Object.create(SourceIngestionWorkerService.prototype) as SourceIngestionWorkerService;
  Object.assign(worker, {
    pool,
    logger: logger ?? {
      warn: () => {},
      log: () => {},
      error: () => {},
    },
    recovering: false,
  });
  return worker;
}

describe("MEM-024 BullMQ ingestion worker lease recovery", () => {
  it("resets recovering lock when pool.connect rejects and succeeds on retry (regression test)", async () => {
    let releaseCalls = 0;
    const executedQueries: string[] = [];
    const mockClient = {
      query: async (sql: string) => {
        executedQueries.push(sql);
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return {};
        return { rowCount: 2, rows: [{ id: "outbox-1" }, { id: "outbox-2" }] };
      },
      release: () => {
        releaseCalls += 1;
      },
    };

    let connectAttempts = 0;
    const mockPool = {
      connect: async () => {
        connectAttempts += 1;
        if (connectAttempts === 1) {
          throw new Error("database connection failure with sensitive host: postgres://user:secret-pass@db.internal/memora");
        }
        return mockClient;
      },
    };

    const warnings: unknown[][] = [];
    const mockLogger: MockLogger = {
      warn: (...args: unknown[]) => {
        warnings.push(args);
      },
    };

    const worker = createIsolatedWorker(mockPool, mockLogger);

    // First recovery attempt: pool.connect() rejects
    const firstResult = await worker.recoverExpiredLeases();
    assert.equal(firstResult, 0, "first recovery call must return 0 when pool.connect rejects");
    assert.equal(connectAttempts, 1, "first recovery call must have attempted connect once");
    assert.equal(releaseCalls, 0, "no client release must be attempted when connect fails");
    assert.equal((worker as unknown as { recovering: boolean }).recovering, false, "recovering flag must be reset to false after connect failure");

    // Second recovery attempt: pool.connect() succeeds
    const secondResult = await worker.recoverExpiredLeases();
    assert.equal(secondResult, 2, "second recovery call must execute transaction and return recovered count");
    assert.equal(connectAttempts, 2, "connect must be called a second time on retry");
    assert.equal(releaseCalls, 1, "acquired client must be released exactly once");
    assert.equal((worker as unknown as { recovering: boolean }).recovering, false, "recovering flag must be reset to false after success");

    // Verify transaction sequence
    assert.ok(executedQueries.includes("BEGIN"), "transaction must begin");
    assert.ok(executedQueries.includes("COMMIT"), "transaction must commit");

    // Verify logging does not leak sensitive information
    assert.equal(warnings.length, 1, "only global failure warning should be logged for the first cycle");
    assert.equal(warnings[0]?.[0], "Ingestion lease recovery cycle failed.");
    for (const callArgs of warnings) {
      for (const arg of callArgs) {
        assert.ok(!(arg instanceof Error), "Error object must never be logged");
        assert.doesNotMatch(String(arg), /secret-pass/, "passwords or connection strings must never be logged");
        assert.doesNotMatch(String(arg), /database connection failure/, "error messages must not be leaked");
      }
    }
  });

  it("resets recovering lock and logs fixed warnings without leaking diagnostics when ROLLBACK fails", async () => {
    let releaseCalls = 0;
    const mockClient = {
      query: async (sql: string) => {
        if (sql === "BEGIN") return {};
        if (sql === "ROLLBACK") {
          throw new Error("rollback failed: connection broken on port 5432 with token=super-secret-token");
        }
        throw new Error("query failure with parameters: [private-workspace-secret-999]");
      },
      release: () => {
        releaseCalls += 1;
      },
    };

    const mockPool = {
      connect: async () => mockClient,
    };

    const warnings: unknown[][] = [];
    const mockLogger: MockLogger = {
      warn: (...args: unknown[]) => {
        warnings.push(args);
      },
    };

    const worker = createIsolatedWorker(mockPool, mockLogger);

    const result = await worker.recoverExpiredLeases();
    assert.equal(result, 0, "recovery must return 0 on transaction and rollback failure");
    assert.equal(releaseCalls, 1, "client must be released even when rollback fails");
    assert.equal((worker as unknown as { recovering: boolean }).recovering, false, "recovering lock must be reset to false");

    // Verify warning messages
    const flatMessages = warnings.map((w) => w[0]);
    assert.ok(flatMessages.includes("Ingestion lease recovery rollback failed."), "rollback failure warning must be logged");
    assert.ok(flatMessages.includes("Ingestion lease recovery cycle failed."), "cycle failure warning must be logged");

    // Verify no sensitive data or Error objects leaked
    for (const callArgs of warnings) {
      for (const arg of callArgs) {
        assert.ok(!(arg instanceof Error), "Error object must never be logged");
        assert.doesNotMatch(String(arg), /super-secret-token/, "tokens must not be logged");
        assert.doesNotMatch(String(arg), /private-workspace-secret-999/, "query parameters or private data must not be logged");
        assert.doesNotMatch(String(arg), /connection broken/, "raw error messages must not be logged");
      }
    }

    // Verify lock is reset by allowing a subsequent call
    let nextCalled = false;
    mockClient.query = async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT") return {};
      nextCalled = true;
      return { rowCount: 1, rows: [{ id: "res" }] };
    };
    const nextResult = await worker.recoverExpiredLeases();
    assert.equal(nextResult, 1);
    assert.equal(nextCalled, true, "subsequent recovery must run without being blocked by lock");
    assert.equal(releaseCalls, 2);
    assert.equal((worker as unknown as { recovering: boolean }).recovering, false);
  });

  it("resets recovering lock and logs fixed warning when client release fails after successful transaction", async () => {
    let releaseCalls = 0;
    const mockClient = {
      query: async (sql: string) => {
        if (sql === "BEGIN" || sql === "COMMIT") return {};
        return { rowCount: 3, rows: [{ id: "outbox-1" }, { id: "outbox-2" }, { id: "outbox-3" }] };
      },
      release: () => {
        releaseCalls += 1;
        throw new Error("client release failed: pool connection leaked with secret-credential=xyz");
      },
    };

    const mockPool = {
      connect: async () => mockClient,
    };

    const warnings: unknown[][] = [];
    const mockLogger: MockLogger = {
      warn: (...args: unknown[]) => {
        warnings.push(args);
      },
    };

    const worker = createIsolatedWorker(mockPool, mockLogger);

    const result = await worker.recoverExpiredLeases();
    assert.equal(result, 3, "transaction succeeded and committed before release");
    assert.equal(releaseCalls, 1, "release must have been attempted once");
    assert.equal((worker as unknown as { recovering: boolean }).recovering, false, "recovering lock must be reset to false");

    // Verify warning messages
    const flatMessages = warnings.map((w) => w[0]);
    assert.ok(flatMessages.includes("Ingestion lease recovery release failed."), "release failure warning must be logged");

    // Verify no sensitive data or Error objects leaked
    for (const callArgs of warnings) {
      for (const arg of callArgs) {
        assert.ok(!(arg instanceof Error), "Error object must never be logged");
        assert.doesNotMatch(String(arg), /secret-credential/, "credentials must not be logged");
        assert.doesNotMatch(String(arg), /pool connection leaked/, "raw error messages must not be logged");
      }
    }

    // Verify lock is reset by calling recovery again
    const nextResult = await worker.recoverExpiredLeases();
    assert.equal(nextResult, 3);
    assert.equal(releaseCalls, 2);
    assert.equal((worker as unknown as { recovering: boolean }).recovering, false);
  });

  it("resets recovering lock and logs fixed warnings when client release fails after transaction failure", async () => {
    let releaseCalls = 0;
    let rollbackCalled = false;
    const mockClient = {
      query: async (sql: string) => {
        if (sql === "BEGIN") return {};
        if (sql === "ROLLBACK") {
          rollbackCalled = true;
          return {};
        }
        throw new Error("fatal query error with confidential payload");
      },
      release: () => {
        releaseCalls += 1;
        throw new Error("release failed with leak-data");
      },
    };

    const mockPool = {
      connect: async () => mockClient,
    };

    const warnings: unknown[][] = [];
    const mockLogger: MockLogger = {
      warn: (...args: unknown[]) => {
        warnings.push(args);
      },
    };

    const worker = createIsolatedWorker(mockPool, mockLogger);

    const result = await worker.recoverExpiredLeases();
    assert.equal(result, 0);
    assert.equal(rollbackCalled, true);
    assert.equal(releaseCalls, 1);
    assert.equal((worker as unknown as { recovering: boolean }).recovering, false, "recovering lock must be reset");

    const flatMessages = warnings.map((w) => w[0]);
    assert.ok(flatMessages.includes("Ingestion lease recovery cycle failed."));
    assert.ok(flatMessages.includes("Ingestion lease recovery release failed."));

    for (const callArgs of warnings) {
      for (const arg of callArgs) {
        assert.ok(!(arg instanceof Error));
        assert.doesNotMatch(String(arg), /confidential payload/);
        assert.doesNotMatch(String(arg), /leak-data/);
      }
    }
  });

  it("short-circuits concurrent recovery calls while recovering is in progress", async () => {
    let resolveConnect: ((client: unknown) => void) | undefined;
    let connectCalls = 0;

    const mockClient = {
      query: async () => ({ rowCount: 1, rows: [{ id: "outbox-1" }] }),
      release: () => {},
    };

    const mockPool = {
      connect: async () => {
        connectCalls += 1;
        return new Promise((resolve) => {
          resolveConnect = () => resolve(mockClient);
        });
      },
    };

    const worker = createIsolatedWorker(mockPool);

    // Launch first recovery (will hang waiting for connect)
    const firstPromise = worker.recoverExpiredLeases();
    assert.equal((worker as unknown as { recovering: boolean }).recovering, true);

    // Launch second recovery concurrently
    const concurrentResult = await worker.recoverExpiredLeases();
    assert.equal(concurrentResult, 0, "concurrent call must early-return 0 without acquiring pool");
    assert.equal(connectCalls, 1, "connect should only have been called once");

    // Unblock first recovery
    resolveConnect?.(mockClient);
    const firstResult = await firstPromise;
    assert.equal(firstResult, 1);
    assert.equal((worker as unknown as { recovering: boolean }).recovering, false, "recovering flag must be false after completion");
  });
});
