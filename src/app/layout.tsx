import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://xerokey.run";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#000000",
  colorScheme: "dark",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Xerokey | Autonomous Smart NFC Locker System",
    template: "%s | Xerokey",
  },
  description:
    "Xerokey is the ultimate autonomous smart NFC locker system for universities, libraries, and enterprises. Instant university ID tap check-in, real-time IoT telemetry, 7-byte UID verification, and offline-first edge architecture.",
  keywords: [
    "xerokey",
    "xero key",
    "Xerokey",
    "XeroKey",
    "xerokey locker",
    "xerokey smart locker",
    "xerokey nfc",
    "xerokey autonomous locker",
    "xerokey run",
    "xerorun",
    "xerokey.run",
    "smart locker system",
    "nfc smart locker",
    "esp32 smart locker",
    "autonomous nfc locker",
    "university smart locker",
    "iot locker system",
    "ashiqrun xerokey",
    "ashiqrun",
  ],
  authors: [{ name: "Ashiqrun", url: "https://ashiq.run" }],
  creator: "Ashiqrun (xerorun.com)",
  publisher: "Xerokey",
  applicationName: "Xerokey",
  alternates: {
    canonical: siteUrl,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: "Xerokey",
    title: "Xerokey | Autonomous Smart NFC Locker System",
    description:
      "Xerokey is the ultimate autonomous smart NFC locker system. Instant tap check-in with university ID, live IoT telemetry, and high security.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Xerokey Autonomous Smart NFC Locker System",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Xerokey | Autonomous Smart NFC Locker System",
    description:
      "Instant tap check-in with university ID, real-time IoT telemetry, and offline-first security by Xerokey.",
    creator: "@ashiqrun",
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  category: "technology",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
  },
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        url: siteUrl,
        name: "Xerokey",
        alternateName: [
          "Xero Key",
          "Xerokey System",
          "Xerokey Locker",
          "xerokey.run",
          "XeroKey Smart Locker",
        ],
        description:
          "Autonomous Smart NFC Locker System for universities, libraries, and public spaces.",
        publisher: {
          "@id": `${siteUrl}/#organization`,
        },
      },
      {
        "@type": "Organization",
        "@id": `${siteUrl}/#organization`,
        name: "Xerokey",
        alternateName: "Xero Key",
        url: siteUrl,
        logo: `${siteUrl}/favicon.ico`,
        founder: {
          "@type": "Person",
          name: "Ashiqrun",
          url: "https://ashiq.run",
        },
        parentOrganization: {
          "@type": "Organization",
          name: "Xerorun",
          url: "https://xerorun.com",
        },
        sameAs: [
          "https://github.com/ashiqrun",
          "https://linkedin.com/in/ashiqrun",
          "https://instagram.com/ashiqrun",
          "https://ashiq.run",
        ],
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${siteUrl}/#software`,
        name: "Xerokey Security System",
        applicationCategory: "SecurityApplication",
        operatingSystem: "ESP32, Web",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        description:
          "Autonomous 12-bay NFC smart locker controller firmware and real-time cloud management matrix.",
      },
      {
        "@type": "Product",
        "@id": `${siteUrl}/#product`,
        name: "Xerokey Autonomous NFC Locker",
        description:
          "Smart locker system with 7-byte NFC UID verification, dual-slot state machine, DS3231 RTC offline logging, and live IoT telemetry.",
        brand: {
          "@type": "Brand",
          name: "Xerokey",
        },
        manufacturer: {
          "@id": `${siteUrl}/#organization`,
        },
      },
    ],
  };

  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-black text-zinc-100 selection:bg-emerald-500/30 selection:text-emerald-200`}
      >
        {children}
      </body>
    </html>
  );
}
