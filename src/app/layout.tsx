import "./globals.css";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import Sidebar from "@/components/Sidebar/Sidebar";
import Navbar from "@/components/Navbar/Navbar";
import WebAnalytics from "@/components/WebAnalytics";
import AuthProvider from "@/components/AuthProvider";
import { WorkspaceProvider } from "@/hooks/useWordLists";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme/bootstrap";
import { openGraphLocales } from "@/i18n/config";
import ClientMessages from "@/i18n/ClientMessages";
import { siteUrl } from "@/lib/siteUrl";

// Vercel serves the analytics script at /_vercel/insights; anywhere else (local builds, CI) it would 404.
const onVercel = process.env.VERCEL === "1";

const GOOGLE_SITE_VERIFICATION = "9AxSaSJWX-s1vpCQI0DDHzhVq9Aq8poWc7q4YX-Js-I";



export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations("metadata");
  const title = t("title");
  const description = t("description");
  const socialImage = {
    url: "/og-image.png",
    width: 1200,
    height: 630,
    type: "image/png",
    alt: t("imageAlt"),
  };
  return {
    metadataBase: new URL(siteUrl),
    // Proves ownership of the site in Google Search Console (URL-prefix property). Not a secret.
    verification: { google: GOOGLE_SITE_VERIFICATION },
    title,
    description,
    openGraph: {
      type: "website",
      locale: openGraphLocales[locale],
      siteName: "Typle",
      title,
      description,
      images: [socialImage],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  // Set by src/proxy.ts for the script policy; absent only where the proxy does not run.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // The class on <html> must not change with the language: the theme script adds `dark` there.
    <html lang={locale} suppressHydrationWarning className="font-sans">
      <head>
        <script id="theme-bootstrap" nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="bg-muted/40 font-sans text-foreground antialiased">
      <ClientMessages>
      <AuthProvider>
      <WorkspaceProvider>
      <Navbar />
      <div className="flex min-h-[calc(100dvh-3.5rem)]">
        <Sidebar />
        <div id="main-content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          { children }
        </div>
      </div>
      </WorkspaceProvider>
      </AuthProvider>
      </ClientMessages>
      {onVercel && <WebAnalytics />}
      </body>
    </html>
  );
}
