import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Geist_Mono, Outfit, Syne } from "next/font/google";
import { AppTabBar, SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-body",
  subsets: ["latin"],
});

const syne = Syne({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "MTG Central",
    template: "%s · MTG Central",
  },
  description:
    "Save Commander decks locally, compare lists side-by-side, and diff upgrades against a reference list. Installable as an app.",
  applicationName: "MTG Central",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MTG Central",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#070d18" },
    { media: "(prefers-color-scheme: light)", color: "#070d18" },
  ],
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${syne.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="atmosphere grain flex min-h-full flex-col font-sans">
        <ServiceWorkerRegister />
        <Suspense fallback={<div className="h-14 border-b border-border/50" />}>
          <SiteHeader />
        </Suspense>
        <main className="flex-1 pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </main>
        <SiteFooter />
        <Suspense fallback={null}>
          <AppTabBar />
        </Suspense>
      </body>
    </html>
  );
}
