export interface SourceIngestionContext {
  ingestionId: string;
  sourceId: string;
  workspaceId: string;
  attempt: number;
}

/**
 * Implementations must re-check source/workspace ownership before reading content.
 * The orchestration layer passes identifiers only; it never places source content in Redis.
 */
export interface SourceIngestionProcessor {
  process(context: SourceIngestionContext): Promise<void>;
}

export const SOURCE_INGESTION_PROCESSOR = Symbol("SOURCE_INGESTION_PROCESSOR");

export class PermanentSourceIngestionError extends Error {
  constructor(readonly code: "processor_unavailable" | "unsupported_source" | "invalid_source_state") {
    super(code);
    this.name = "PermanentSourceIngestionError";
  }
}

/** Safe default: ingestion is explicitly failed until a real processor is registered. */
export class UnconfiguredSourceIngestionProcessor implements SourceIngestionProcessor {
  async process(): Promise<void> {
    throw new PermanentSourceIngestionError("processor_unavailable");
  }
}
