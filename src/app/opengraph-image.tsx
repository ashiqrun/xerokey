import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Xerokey - Autonomous Smart NFC Locker System";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          backgroundColor: "#000000",
          backgroundImage:
            "radial-gradient(circle at 50% 0%, rgba(16, 185, 129, 0.25) 0%, transparent 60%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
          border: "2px solid #27272a",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: "20px",
              height: "20px",
              borderRadius: "50%",
              backgroundColor: "#10b981",
              boxShadow: "0 0 20px #10b981",
            }}
          />
          <span
            style={{
              fontSize: "24px",
              letterSpacing: "6px",
              textTransform: "uppercase",
              color: "#10b981",
              fontWeight: 700,
            }}
          >
            XEROKEY // AUTONOMOUS SECURITY
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <h1
            style={{
              fontSize: "84px",
              letterSpacing: "14px",
              fontWeight: 800,
              textTransform: "uppercase",
              margin: 0,
              color: "#ffffff",
            }}
          >
            XEROKEY
          </h1>
          <p
            style={{
              fontSize: "30px",
              color: "#a1a1aa",
              margin: 0,
              letterSpacing: "2px",
            }}
          >
            Autonomous Smart NFC Locker System with Live Telemetry
          </p>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid #27272a",
            paddingTop: "28px",
          }}
        >
          <span
            style={{
              fontSize: "20px",
              letterSpacing: "3px",
              color: "#71717a",
              textTransform: "uppercase",
            }}
          >
            Powered by xerorun.com • Created by Ashiqrun
          </span>
          <span
            style={{
              fontSize: "20px",
              letterSpacing: "2px",
              color: "#10b981",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            xerokey.run
          </span>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
