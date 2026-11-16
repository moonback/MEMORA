import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { queueAuthEmail } from "./mailer.js";
import { ensurePersonalWorkspace } from "../workspaces/personal-workspace.service.js";
import { setAuthUserContext } from "./db-context.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../..", ".env") });

const databaseUrl = process.env.DATABASE_APP_URL;
if (!databaseUrl) throw new Error("DATABASE_APP_URL must point to the non-owner, NOBYPASSRLS runtime database role.");
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const secret = process.env.BETTER_AUTH_SECRET ?? "memora-local-development-secret-change-before-deploy";
if (process.env.NODE_ENV === "production") {
  if (secret.length < 32 || secret.includes("replace-with") || !process.env.BETTER_AUTH_SECRET) {
    throw new Error("A unique BETTER_AUTH_SECRET of at least 32 characters is required in production.");
  }
  if (!process.env.SMTP_HOST || !process.env.SMTP_PORT || !process.env.SMTP_FROM) {
    throw new Error("SMTP_HOST, SMTP_PORT and SMTP_FROM are required in production.");
  }
}

export const authPool = new Pool({ connectionString: databaseUrl, max: 10 });

export const auth = betterAuth({
  appName: "MEMORA",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:4000",
  basePath: "/api/auth",
  secret,
  trustedOrigins: [webOrigin],
  database: authPool,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    autoSignIn: false,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      queueAuthEmail({
        to: user.email,
        subject: "Réinitialiser votre mot de passe MEMORA",
        text: `Pour choisir un nouveau mot de passe, ouvrez ce lien : ${url}`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, url }) => {
      queueAuthEmail({
        to: user.email,
        subject: "Confirmez votre adresse e-mail MEMORA",
        text: `Pour confirmer votre adresse e-mail, ouvrez ce lien : ${url}`,
      });
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const client = await authPool.connect();
          try {
            await client.query("BEGIN");
            await setAuthUserContext(client, user.id);
            const appUser = await client.query<{ id: string }>(
              `INSERT INTO users (email, display_name, auth_user_id)
               VALUES ($1, $2, $3)
               ON CONFLICT (auth_user_id) DO UPDATE
                 SET email = EXCLUDED.email, display_name = EXCLUDED.display_name
               RETURNING id`,
              [user.email, user.name, user.id],
            );
            const appUserRow = appUser.rows[0];
            if (!appUserRow) throw new Error("Could not provision the MEMORA user profile.");
            const userId = appUserRow.id;
            await ensurePersonalWorkspace(client, userId);
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally {
            client.release();
          }
        },
      },
    },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  },
});
