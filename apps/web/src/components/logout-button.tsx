"use client";

import { useState } from "react";
import { authClient } from "../lib/auth-client";

export function LogoutButton() {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await authClient.signOut();
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <button className="logout-button" type="button" onClick={signOut} disabled={busy}>
      {busy ? "Déconnexion…" : "Se déconnecter"}
    </button>
  );
}
