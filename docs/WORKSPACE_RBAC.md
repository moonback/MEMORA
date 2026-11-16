# Workspace Membership & RBAC

## Roles
| Capability | Owner | Admin | Member | Viewer |
|---|---:|---:|---:|---:|
| List workspace members | Yes | Yes | Yes | Yes |
| Invite member / viewer | Yes | Yes | No | No |
| Invite administrator | Yes | No | No | No |
| Change member / viewer role | Yes | Yes | No | No |
| Promote to administrator | Yes | No | No | No |
| Change/remove another administrator | Yes | No | No | No |
| Remove a member / viewer | Yes | Yes | No | No |
| Leave workspace | Yes* | Yes | Yes | Yes |

*The owner cannot leave until ownership transfer exists. Owner transfer is not implemented in MEM-013.*

## Workspace membership endpoints
- `GET /api/workspaces`: list the caller's active memberships.
- `POST /api/workspaces`: create a shared workspace and create its owner membership atomically.
- `GET /api/workspaces/:workspaceId/members`: list members (all active roles).
- `PATCH /api/workspaces/:workspaceId/members/:memberUserId`: change an assignable role.
- `DELETE /api/workspaces/:workspaceId/members/:memberUserId`: remove a member subject to role policy.
- `DELETE /api/workspaces/:workspaceId/members/me`: leave a workspace; owners are blocked.

## Invitations
- `POST /api/workspaces/:workspaceId/invitations`: invite by email with role `admin`, `member` or `viewer`.
- `GET /api/workspaces/:workspaceId/invitations`: list invitations and their pending/expired/accepted state.
- `DELETE /api/workspaces/:workspaceId/invitations/:invitationId`: revoke a pending invitation.
- `POST /api/invitations/accept`: accept a single-use invitation while authenticated with a verified matching email.
- Invitation tokens contain 256 bits of random entropy. Only a SHA-256 hash is stored in PostgreSQL; the raw token is sent by email.
- Invitations expire after seven days. Reissuing a pending invitation rotates its token and expiry.
- Invitations are permitted only for shared workspaces; personal workspaces remain private.

## Authorization enforcement
The global NestJS `AuthGuard` protects API routes by default. Only health endpoints are explicitly public; Better Auth endpoints are handled by Better Auth itself. Workspace member/invitation routes additionally use `WorkspaceMembershipGuard`, which resolves the caller's domain user ID from the authenticated identity, requires active membership, rejects archived workspaces, and enforces role metadata. Controllers recheck actor roles inside transactions for membership mutations.

Workspace IDs and member/invitation IDs are validated as UUIDs. Owner IDs are never accepted from request bodies. The API resolves all user and workspace scope from the authenticated session and route membership.

## Remaining boundaries
Viewer/member data permissions will be applied to future memory/source APIs. Owner transfer, invitation resend throttling, invitation email delivery retries, audit events and PostgreSQL RLS remain future work. MEM-013 provides application-layer authorization; MEM-014 adds database-enforced tenant isolation.
