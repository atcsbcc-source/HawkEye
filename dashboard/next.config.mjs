const isProd = process.env.NODE_ENV === "production";
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const supabaseWs = supabaseUrl.replace(/^https:/, "wss:");
const devMode = !supabaseUrl;

const csp = [
  "default-src 'self'",
  // Next's hydration/runtime scripts are inline; eval is needed for HMR in dev.
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  // Leaflet / react-leaflet set inline styles on map panes and markers.
  "style-src 'self' 'unsafe-inline'",
  [
    "img-src 'self' data: blob:",
    "https://*.basemaps.cartocdn.com",
    // picsum placeholders only exist in mock mode.
    ...(devMode ? ["https://picsum.photos", "https://fastly.picsum.photos"] : []),
    ...(supabaseUrl ? [supabaseUrl] : []),
  ].join(" "),
  ["connect-src 'self'", ...(supabaseUrl ? [supabaseUrl, supabaseWs] : [])].join(" "),
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isProd ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  experimental: { instrumentationHook: true },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
