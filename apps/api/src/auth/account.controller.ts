import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  UnauthorizedException,
} from "@nestjs/common";
import { z } from "zod";
import { auth, authPool } from "./auth.js";
import { CurrentSession } from "./current-session.decorator.js";
import { DomainUserNotFoundError, withUserContext } from "./db-context.js";

type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

const isValidLocale = (value: string) => {
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
};

const isValidTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  locale: z.string().trim().min(2).max(16).refine(isValidLocale, "Locale BCP 47 invalide").optional(),
  timeZone: z.string().trim().min(1).max(64).refine(isValidTimeZone, "Fuseau horaire IANA invalide").optional(),
}).strict().refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  "Au moins un champ doit être modifié",
);

@Controller("account")
export class AccountController {
  @Get("me")
  async me(@CurrentSession() session: AuthSession | undefined) {
    if (!session) throw new UnauthorizedException();
    try {
      return await withUserContext(authPool, session.user.id, async (client, userId) => {
        const result = await client.query<{
          id: string;
          email: string;
          display_name: string | null;
          locale: string;
          time_zone: string;
        }>(
          `SELECT id, email, display_name, locale, time_zone
           FROM users WHERE id = $1 LIMIT 1`,
          [userId],
        );
        const profile = result.rows[0];
        if (!profile) throw new NotFoundException("Profil MEMORA introuvable.");

        const workspaceResult = await client.query<{
          id: string;
          name: string;
          slug: string;
          type: string;
          description: string | null;
          metadata: Record<string, unknown>;
          archived_at: Date | null;
          created_at: Date;
          updated_at: Date;
        }>(
          `SELECT id, name, slug, type, description, metadata, archived_at, created_at, updated_at
           FROM workspaces WHERE owner_user_id = $1 AND type = 'personal' LIMIT 1`,
          [profile.id],
        );
        const personalWorkspace = workspaceResult.rows[0];

        return {
          user: {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            emailVerified: session.user.emailVerified,
          },
          profile: {
            id: profile.id,
            displayName: profile.display_name,
            locale: profile.locale,
            timeZone: profile.time_zone,
          },
          workspace: personalWorkspace ? {
            id: personalWorkspace.id,
            name: personalWorkspace.name,
            slug: personalWorkspace.slug,
            type: personalWorkspace.type,
            description: personalWorkspace.description,
            metadata: personalWorkspace.metadata,
            archivedAt: personalWorkspace.archived_at,
            createdAt: personalWorkspace.created_at,
            updatedAt: personalWorkspace.updated_at,
          } : null,
          session: {
            id: session.session.id,
            expiresAt: session.session.expiresAt,
          },
        };
      });
    } catch (error) {
      if (error instanceof DomainUserNotFoundError) throw new NotFoundException("Profil MEMORA introuvable.");
      throw error;
    }
  }

  @Patch("me")
  async updateMe(
    @CurrentSession() session: AuthSession | undefined,
    @Body() body: unknown,
  ) {
    if (!session) throw new UnauthorizedException();
    const parsed = profileUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Paramètres de profil invalides.",
        issues: parsed.error.issues,
      });
    }

    const { name, locale, timeZone } = parsed.data;
    try {
      return await withUserContext(authPool, session.user.id, async (client, userId) => {
        if (name !== undefined) {
          await client.query(
            `UPDATE "user" SET name = $1, "updatedAt" = now() WHERE id = $2`,
            [name, session.user.id],
          );
        }
        const updated = await client.query<{
          id: string;
          email: string;
          display_name: string | null;
          locale: string;
          time_zone: string;
        }>(
          `UPDATE users
           SET display_name = COALESCE($1, display_name),
               locale = COALESCE($2, locale),
               time_zone = COALESCE($3, time_zone),
               updated_at = now()
           WHERE id = $4
           RETURNING id, email, display_name, locale, time_zone`,
          [name ?? null, locale ?? null, timeZone ?? null, userId],
        );
        const profile = updated.rows[0];
        if (!profile) throw new NotFoundException("Profil MEMORA introuvable.");
        return {
          profile: {
            id: profile.id,
            displayName: profile.display_name,
            locale: profile.locale,
            timeZone: profile.time_zone,
          },
        };
      });
    } catch (error) {
      if (error instanceof DomainUserNotFoundError) throw new NotFoundException("Profil MEMORA introuvable.");
      throw error;
    }
  }
}
