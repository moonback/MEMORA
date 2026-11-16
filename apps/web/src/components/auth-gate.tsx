"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "../lib/auth-client";

export function AuthGate({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  const router = useRouter();

  useEffect(() => {
    if (!isPending && !session) router.replace("/login");
  }, [isPending, session, router]);

  if (isPending || !session) {
    return <main className="auth-shell"><section className="auth-card"><span className="auth-brand">MEMORA</span><p className="auth-description">Vérification de votre session…</p></section></main>;
  }
  return children;
}
