import type { Metadata, Viewport } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import { Sidebar } from "@/components/shell/Sidebar";
import { Header } from "@/components/shell/Header";
import { HeaderTitleProvider } from "@/components/shell/HeaderTitle";
import { ToastProvider } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: { default: "HawkEye Command Center", template: "%s · HawkEye" },
  description: "Drone-driven vacancy reconnaissance for distressed-property leads",
  applicationName: "HawkEye",
};

export const viewport: Viewport = {
  themeColor: "#0b1220",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <ToastProvider>
          <HeaderTitleProvider>
            <div className="flex min-h-screen">
              <Sidebar />
              <div className="flex min-w-0 flex-1 flex-col">
                {/* Session chip / dev-mode badge goes in the `actions` slot. */}
                <Header />
                <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
              </div>
            </div>
          </HeaderTitleProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
