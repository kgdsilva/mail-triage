import { NavLink } from '@/components/nav-link'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Settings</h1>
      <nav className="flex gap-1 border-b border-neutral-200 pb-2 dark:border-neutral-800">
        <NavLink href="/settings/entities">Entities</NavLink>
        <NavLink href="/settings/types">Document types</NavLink>
        <NavLink href="/settings/vendors">Vendors</NavLink>
        <NavLink href="/settings/autopay">Autopay</NavLink>
        <NavLink href="/settings/members">Members</NavLink>
      </nav>
      {children}
    </div>
  )
}
