import { NavLink } from '@/components/nav-link'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h1 className="text-[28px] font-extrabold text-navy-900">Settings</h1>
      <nav className="flex gap-1 border-b border-line">
        <NavLink href="/settings/entities" tone="page">
          Entities
        </NavLink>
        <NavLink href="/settings/types" tone="page">
          Document types
        </NavLink>
        <NavLink href="/settings/vendors" tone="page">
          Vendors
        </NavLink>
        <NavLink href="/settings/autopay" tone="page">
          Autopay
        </NavLink>
        <NavLink href="/settings/members" tone="page">
          Members
        </NavLink>
      </nav>
      {children}
    </div>
  )
}
