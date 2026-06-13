import type { Metadata } from "next";
import { DM_Sans, Space_Mono } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  preload: true,
  variable: "--font-dm-sans",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  preload: true,
  variable: "--font-space-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "Guess My Person — Multiplayer Guessing Game",
  description:
    "The ultimate multiplayer guessing game. Create or join a room, ask yes/no questions, and guess the mystery person!",
  openGraph: {
    title: "Guess My Person — Multiplayer Guessing Game",
    description:
      "Create or join a room, ask yes/no questions, and guess the mystery person before time runs out!",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Guess My Person — Multiplayer Guessing Game",
    description:
      "Create or join a room, ask yes/no questions, and guess the mystery person before time runs out!",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#3b82f6" />
        <link
          rel="icon"
          href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%230b0f19'/><text x='50' y='68' font-size='60' font-family='monospace' font-weight='bold' fill='%2338bdf8' text-anchor='middle'>?</text></svg>"
        />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className={`${dmSans.variable} ${spaceMono.variable}`}>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').catch(function() {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
