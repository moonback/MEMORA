import { Controller, Get, UnauthorizedException } from "@nestjs/common";
import { CurrentSession } from "./current-session.decorator.js";

@Controller("account")
export class AccountController {
  @Get("me")
  me(@CurrentSession() session: {
    user: { id: string; name: string; email: string; emailVerified: boolean };
    session: { id: string; expiresAt: Date };
  } | undefined) {
    if (!session) throw new UnauthorizedException();
    return {
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        emailVerified: session.user.emailVerified,
      },
      session: {
        id: session.session.id,
        expiresAt: session.session.expiresAt,
      },
    };
  }
}
