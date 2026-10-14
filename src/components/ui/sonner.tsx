"use client";

import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="top-center"
      toastOptions={{
        style: { background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border)" },
      }}
    />
  );
}
