import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Xerokey - Autonomous Smart NFC Locker System",
    short_name: "Xerokey",
    description:
      "Next-generation autonomous NFC locker system with live telemetry, offline-first IoT architecture, and high security.",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#10b981",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
