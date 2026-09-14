import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { AccessibilityProvider } from "@/components/AccessibilityProvider";

export const metadata: Metadata = {
  title: "SAATH - You don't have to walk alone",
  description:
    "Continuous, voluntary trauma-informed mental-health care and support for survivors. You don't have to walk alone.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/saath-logo.png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SAATH",
  },
};

export const viewport: Viewport = {
  themeColor: "#0F766E",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-warm-cream text-text-primary">
        <AccessibilityProvider />
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
