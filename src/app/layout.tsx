import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Capital Delivery Accelerator",
  description: "Turn engineering diagrams into a connected, enriched asset model. Prototype with fictional sample data.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// Applies a saved theme before first paint to avoid a flash.
const themeScript = `try{var t=localStorage.getItem("cda-theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
