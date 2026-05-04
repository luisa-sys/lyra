import type { Metadata } from "next";
import { DM_Sans, DM_Serif_Display } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { CookieConsent } from "./cookie-consent";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const dmSerif = DM_Serif_Display({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400"],
});

export const metadata: Metadata = {
  title: "Lyra — Let people know you",
  description:
    "A calm profile where you share your preferences, gift ideas, and boundaries — so people in your life never have to guess.",
  metadataBase: new URL("https://checklyra.com"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Lyra — Let people know you",
    description:
      "Share preferences, gift ideas, and boundaries. So people in your life never have to guess.",
    url: "https://checklyra.com",
    siteName: "Lyra",
    type: "website",
    locale: "en_GB",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Lyra — Let people know you",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Lyra — Let people know you",
    description:
      "Share preferences, gift ideas, and boundaries. So people in your life never have to guess.",
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
};
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${dmSans.variable} ${dmSerif.variable}`}>
      <body className="min-h-screen bg-stone-50 text-stone-800 font-[family-name:var(--font-sans)] antialiased">
        {children}
        <CookieConsent />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}