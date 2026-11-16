# Profile & Account Settings

## API
- `GET /api/account/me` returns the Better Auth identity, MEMORA profile, personal workspace and current session.
- `PATCH /api/account/me` accepts `name`, `locale` and `timeZone`.
- Profile changes validate BCP 47 locale tags and IANA time-zone identifiers.
- The auth identity name and MEMORA display name are updated in one PostgreSQL transaction.

## Web settings
The `/settings` page provides profile preferences, password change and active-session management. Password changes use Better Auth's current-password verification and revoke all other active sessions. Individual sessions can be revoked from the device list; the current session is protected from accidental revocation in the UI.

## Supported preferences
- Locale: `fr-FR`, `en-GB`, `en-US` in the current interface.
- Time zone: `Europe/Paris`, `Europe/London`, `UTC`, `America/New_York`, `America/Los_Angeles` in the current interface.

## Boundaries
Changing the email address, deleting the account, consent management and workspace membership administration are not part of MEM-011. Email changes require a separate verification workflow. Workspace authorization and RLS remain MEM-013/MEM-014.
