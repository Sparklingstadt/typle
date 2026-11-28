import ClientMessages from "@/i18n/ClientMessages"

// The messages this route's client components read (see ClientMessages.tsx).
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ClientMessages namespaces={["settings"]}>{children}</ClientMessages>
}
