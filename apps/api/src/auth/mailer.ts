import nodemailer from "nodemailer";

export interface AuthEmail {
  to: string;
  subject: string;
  text: string;
}

export async function sendAuthEmail(message: AuthEmail): Promise<void> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_FROM) {
    throw new Error("Email delivery is not configured. Set SMTP_HOST, SMTP_PORT and SMTP_FROM.");
  }

  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER && SMTP_PASSWORD
      ? { user: SMTP_USER, pass: SMTP_PASSWORD }
      : undefined,
  });

  await transport.sendMail({
    from: SMTP_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
}
