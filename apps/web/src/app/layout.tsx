import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MEMORA — Votre mémoire personnelle",
  description: "Un espace privé pour retrouver ce qui compte."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>{children}</body></html>;
}
