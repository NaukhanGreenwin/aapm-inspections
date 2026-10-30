import type { Metadata, Viewport } from "next";
import { Geist, Instrument_Serif } from "next/font/google";
import "./globals.css";

// Fonts are downloaded at build time and self-hosted: no third-party requests at runtime.
// Same pair as the AA preview site: Geist (UI) + Instrument Serif (headings).
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-serif", display: "swap", style: ["normal", "italic"] });
const sans = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

const isDev = process.env.NODE_ENV !== "production";

// connect-src: the preview send relay (src/lib/send.ts).
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self' blob: data: https://itrs-form-relay.onrender.com${isDev ? " ws:" : ""}`,
  "worker-src 'self'",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export const metadata: Metadata = {
  title: "Move-in / move-out suite inspection | AA Property Management (preview)",
  description: "Room-by-room move-in and move-out suite inspection for AA Property Management & Associates. Preview.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  icons: { icon: `${process.env.NEXT_PUBLIC_BASE_PATH}/brand/favicon.png`, apple: `${process.env.NEXT_PUBLIC_BASE_PATH}/brand/apple-touch-icon.png` },
  referrer: "strict-origin-when-cross-origin",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "overlays-content",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-CA" className={`${serif.variable} ${sans.variable}`}>
      <head>
        <meta httpEquiv="Content-Security-Policy" content={CSP} />
        <meta httpEquiv="X-Content-Type-Options" content="nosniff" />
        <meta name="color-scheme" content="light" />
      </head>
      <body>{children}</body>
    </html>
  );
}
