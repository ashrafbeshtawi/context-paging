import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Context Paging",
  description: "Virtual memory for AI agents — chat UI",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
