"use client"
import { useState } from 'react'
import { signOut, useSession } from '@/lib/session'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogIn, LogOut, Monitor } from 'lucide-react'
import { Avatar } from 'radix-ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const itemClass = "flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&_svg]:size-4 [&_svg]:text-muted-foreground"

function UserAvatar({ name, image, className }: { name: string; image?: string | null; className: string }) {
  return <Avatar.Root className={`relative flex shrink-0 overflow-hidden rounded-full bg-muted ${className}`}>
    <Avatar.Image src={image ?? undefined} alt="" className="size-full object-cover" />
    <Avatar.Fallback aria-hidden="true" className="flex size-full items-center justify-center bg-secondary text-sm font-semibold text-secondary-foreground">
      {Array.from(name.trim() || 'G')[0].toUpperCase()}
    </Avatar.Fallback>
  </Avatar.Root>
}

export default function AccountBar() {
  const { data: session, status } = useSession()
  const t = useTranslations('account')
  const [signOutFailed, setSignOutFailed] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  // Same size as the avatar button so the top bar does not shift once the session is known.
  if (status === 'loading') return <div className="flex size-10 items-center justify-center"><Skeleton className="size-8 rounded-full" /><span className="sr-only">{t('checking')}</span></div>
  if (!session?.user) {
    // The sign-in page comes back to the page being viewed. The link names its path; a click adds the query (as in
    // /play?list=…), which useSearchParams would read only under a Suspense boundary in the layout.
    const signInPath = (returnTo: string) => `/signin?returnTo=${encodeURIComponent(returnTo)}`
    return <Button asChild variant="outline" size="lg" className="gap-2 px-3">
      <Link href={signInPath(pathname)} onClick={event => {
        if (!location.search || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        router.push(signInPath(location.pathname + location.search))
      }}><LogIn aria-hidden="true" />{t('signIn')}</Link>
    </Button>
  }
  // A login with FFPF ID made before v2.54.0 still opens until it expires (the login itself was removed then).
  const viaFfpf = session.user.id.startsWith('ffpf:')
  // An account with an ID and a password is named by its ID.
  const viaPassword = session.user.id.startsWith('password:')
  // A name that is empty (an FFPF ID without one) is no name, so it falls back too.
  const name = session.user.name || t(viaFfpf ? 'ffpfUser' : 'githubUser')
  return <div className="relative">
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-10 rounded-full" aria-label={t('menu')} title={name}>
          <UserAvatar name={name} image={session.user.image} className="size-8" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-60 border-border">
        <DropdownMenuLabel className="flex items-center gap-3 px-3 py-2">
          <UserAvatar name={name} image={session.user.image} className="size-9" />
          <span className="grid min-w-0">
            <span className="truncate text-sm font-medium">{name}</span>
            <span className="text-xs text-muted-foreground">{t(viaPassword ? 'signedInWithPassword' : viaFfpf ? 'signedInWithFfpf' : 'signedInWithGitHub')}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="-mx-1" />
        <DropdownMenuItem asChild variant="bare" className={itemClass}>
          <Link href="/devices"><Monitor aria-hidden="true" />{t('manageDevices')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem variant="bare" className={itemClass} onSelect={() => { setSignOutFailed(false); signOut().catch(() => setSignOutFailed(true)) }}>
          <LogOut aria-hidden="true" />{t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {signOutFailed && <p role="alert" className="absolute top-full right-0 z-50 mt-2 w-56 rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-md">{t('signOutFailed')}</p>}
  </div>
}
