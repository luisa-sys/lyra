import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { CookieConsent } from "./cookie-consent";
import { Footer } from "./footer";
import { InstallPrompt } from "./install-prompt";
import { ServiceWorkerRegister } from "./service-worker-register";
import "./globals.css";

/*
 * KAN-272 — the June-2026 mock-up uses a SINGLE typeface, Inter, for every
 * slot. The app previously loaded DM Sans + DM Serif Display; we now load
 * Inter once and map BOTH --font-sans and --font-serif to it, so every
 * existing `font-[family-name:var(--font-serif)]` slot renders Inter without
 * touching the ~23 components that reference the serif variable.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Lyra — Be understood.",
  description:
    "A place to be understood — a simple page about who you are, in your own words. For your offline life: no feed, no likes, nothing to keep up with.",
  metadataBase: new URL("https://checklyra.com"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Lyra — Be understood.",
    description:
      "A place to be understood, in your own words. For your offline life — no feed, no likes.",
    url: "https://checklyra.com",
    siteName: "Lyra",
    type: "website",
    locale: "en_GB",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Lyra — Be understood.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Lyra — Be understood.",
    description:
      "A place to be understood, in your own words. For your offline life — no feed, no likes.",
    images: ["/og-image.png"],
  },
  // KAN-175: only allow indexing on production. On beta and any non-prod
  // env (dev, staging, preview), emit noindex,nofollow so leaked URLs don't
  // surface in search results. Mirrors the per-env robots.txt logic in
  // src/app/robots.ts.
  robots: (() => {
    const isProductionEnv =
      process.env.IS_BETA_DEPLOY !== 'true' &&
      process.env.VERCEL_ENV === 'production';
    return isProductionEnv
      ? { index: true, follow: true }
      : { index: false, follow: false, noarchive: true, nosnippet: true };
  })(),
  icons: {
    icon: "/favicon.ico",
    apple: "/lyra-icon-180.png",
  },
  // KAN-69a: PWA manifest wiring. Next.js 16 emits a `<link rel="manifest">`
  // automatically when this field is set.
  manifest: "/manifest.webmanifest",
  // Apple's PWA conventions are separate from the W3C manifest. Without
  // these, iOS Safari opens the home-screen icon in a browser tab rather
  // than standalone mode.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Lyra",
  },
};

// KAN-69a: viewport + themeColor live in their own export per Next 16's
// Metadata vs Viewport split. The themeColor maps to the manifest's
// theme_color (sage) so the browser chrome / status bar tint matches the
// installed app icon's background.
export const viewport: Viewport = {
  // KAN-272 — match the redesigned sage (#4a7359, the logo green).
  themeColor: "#4a7359",
  // PWA install prompts on iOS require viewport-fit=cover so the app
  // can paint under the notch / Dynamic Island. Safe-area insets in
  // globals.css handle the actual layout adjustment.
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // KAN-272 — map BOTH font CSS variables to the single Inter face. Inline
  // style (rather than a className) lets us point two variables at one font
  // without a second next/font load.
  return (
    <html
      lang="en"
      className={inter.className}
      style={
        {
          "--font-sans": inter.style.fontFamily,
          "--font-serif": inter.style.fontFamily,
        } as React.CSSProperties
      }
    >
      <body className="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)] font-[family-name:var(--font-sans)] antialiased">
        {children}
        <Footer />
        <CookieConsent />
        <InstallPrompt />
        <ServiceWorkerRegister />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}