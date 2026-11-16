import { BadRequestException, Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { authPool } from "../auth/auth.js";
import { withWorkspaceContext } from "../database/tenant-context.js";
import { CurrentWorkspaceMembership, RequireWorkspaceRoles } from "../workspaces/workspace-membership.decorator.js";
import { WorkspaceMembershipGuard, type WorkspaceMembershipContext } from "../workspaces/workspace-membership.guard.js";

export const manualCaptureSchema = z.object({
  title: z.string().trim().min(1).max(500),
  content: z.string().trim().min(1).max(20_000),
  capturedAt: z.string().datetime().optional(),
}).strict();

export type ManualCaptureInput = z.infer<typeof manualCaptureSchema>;

@Controller("workspaces/:workspaceId/capture")
@UseGuards(WorkspaceMembershipGuard)
export class ManualCaptureController {
  @Post("notes")
  @RequireWorkspaceRoles("owner", "admin", "member")
  async createNote(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
    @Body() body: unknown,
  ) {
    const parsed = manualCaptureSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: "Note invalide.", issues: parsed.error.issues });
    }
    const input = parsed.data;

    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client, { user }) => {
      const capturedAt = input.capturedAt ? new Date(input.capturedAt) : new Date();
      const inserted = await client.query<{
        id: string;
        workspace_id: string;
        created_by_user_id: string;
        type: string;
        status: string;
        title: string | null;
        captured_at: Date | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `INSERT INTO sources
          (workspace_id, created_by_user_id, type, status, title, mime_type, metadata, captured_at)
         VALUES ($1, $2, 'manual', 'pending', $3, 'text/plain', '{}'::jsonb, $4)
         RETURNING id, workspace_id, created_by_user_id, type, status, title, captured_at, created_at, updated_at`,
        [workspaceId, user.id, input.title, capturedAt],
      );
      const source = inserted.rows[0];
      if (!source) throw new Error("La note n'a pas pu être créée.");

      await client.query(
        `INSERT INTO source_chunks
          (workspace_id, source_id, ordinal, content, metadata)
         VALUES ($1, $2, 0, $3, '{}'::jsonb)`,
        [workspaceId, source.id, input.content],
      );

      const ready = await client.query(
        `UPDATE sources SET status = 'ready', processed_at = now(), updated_at = now()
         WHERE id = $1 AND workspace_id = $2
         RETURNING id, workspace_id, created_by_user_id, type, status, title, captured_at, created_at, updated_at`,
        [source.id, workspaceId],
      );
      return { source: ready.rows[0], chunkCount: 1 };
    });
  }
}
