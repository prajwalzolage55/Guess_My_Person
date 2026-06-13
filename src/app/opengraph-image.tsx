import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "Guess My Person — Multiplayer Guessing Game";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: "linear-gradient(145deg, #0a0a0f 0%, #12121a 50%, #0a0a0f 100%)",
          fontFamily: "monospace",
          position: "relative",
        }}
      >
        {/* Background accent circles */}
        <div
          style={{
            position: "absolute",
            top: "-80px",
            right: "-80px",
            width: "400px",
            height: "400px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, transparent 70%)",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "-100px",
            left: "-100px",
            width: "500px",
            height: "500px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(236, 72, 153, 0.12) 0%, transparent 70%)",
            display: "flex",
          }}
        />

        {/* Question mark icon */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100px",
            height: "100px",
            borderRadius: "20px",
            background: "#12121a",
            border: "3px solid #3b82f6",
            boxShadow: "0 0 40px rgba(59, 130, 246, 0.3)",
            fontSize: "56px",
            fontWeight: "bold",
            color: "#3b82f6",
            marginBottom: "32px",
          }}
        >
          ?
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: "64px",
            fontWeight: "bold",
            color: "#f0f0f5",
            letterSpacing: "-2px",
            lineHeight: 1.1,
            display: "flex",
          }}
        >
          GUESS MY PERSON
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: "24px",
            color: "#8888a0",
            marginTop: "16px",
            letterSpacing: "2px",
            textTransform: "uppercase",
            display: "flex",
          }}
        >
          The Ultimate Multiplayer Guessing Game
        </div>

        {/* Accent bar */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            marginTop: "40px",
          }}
        >
          <div
            style={{
              width: "60px",
              height: "4px",
              background: "#3b82f6",
              borderRadius: "2px",
              display: "flex",
            }}
          />
          <div
            style={{
              width: "60px",
              height: "4px",
              background: "#ec4899",
              borderRadius: "2px",
              display: "flex",
            }}
          />
          <div
            style={{
              width: "60px",
              height: "4px",
              background: "#22c55e",
              borderRadius: "2px",
              display: "flex",
            }}
          />
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
