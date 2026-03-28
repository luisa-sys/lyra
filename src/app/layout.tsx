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
  },
  twitter: {
    card: "summary",
    title: "Lyra — Let people know you",
    description:
      "Share preferences, gift ideas, and boundaries. So people in your life never have to guess.",
  },
  robots: {
    index: true,
    follow: true,
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