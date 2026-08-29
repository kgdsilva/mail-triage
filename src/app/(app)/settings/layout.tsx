import { NavLink } from '@/components/nav-link'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h1 className="text-[26px] font-bold tracking-tight text-navy-900">Settings</h1>
      <nav className="flex gap-1 border-b border-line pb-2">
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
