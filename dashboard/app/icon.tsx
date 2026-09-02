import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** Amber crosshair on the console background. */
export default function Icon() {
  return new ImageResponse(<Crosshair px={32} />, { ...size });
}

export function Crosshair({ px }: { px: number }) {
  const ring = Math.round(px * 0.62);
  const stroke = Math.max(2, Math.round(px / 16));
  const arm = Math.round(px * 0.82);
  const core = Math.round(px * 0.18);
  const center = px / 2;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0b1220",
        borderRadius: Math.round(px * 0.18),
      }}
    >
      <div style={{ position: "relative", width: px, height: px, display: "flex" }}>
        <div
          style={{
            position: "absolute",
            left: center - ring / 2,
            top: center - ring / 2,
            width: ring,
            height: ring,
            border: `${stroke}px solid #fbbf24`,
            borderRadius: "50%",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: center - stroke / 2,
            top: center - arm / 2,
            width: stroke,
            height: arm,
            background: "#fbbf24",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: center - stroke / 2,
            left: center - arm / 2,
            width: arm,
            height: stroke,
            background: "#fbbf24",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: center - core / 2,
            top: center - core / 2,
            width: core,
            height: core,
            background: "#0b1220",
            borderRadius: "50%",
          }}
        />
      </div>
    </div>
  );
}
