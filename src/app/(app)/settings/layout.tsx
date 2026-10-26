import { NavLink } from '@/components/nav-link'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h1 className="text-[28px] font-extrabold text-navy-900">Settings</h1>
      <nav className="flex gap-1 border-b border-line">
        <NavLink href="/settings/entities">
          Entities
        </NavLink>
        <NavLink href="/settings/types">
          Document types
        </NavLink>
        <NavLink href="/settings/categories">
          Categories
        </NavLink>
        <NavLink href="/settings/vendors">
          Vendors
        </NavLink>
        {/* Named for the question, not for one of its two answers: the page holds both
            the money taken automatically and the money somebody has to remember. Called
            "Autopay", it told anyone looking for the lawyers that they were not here. */}
        <NavLink href="/settings/autopay">
          Recurring
        </NavLink>
        <NavLink href="/settings/members">
          Members
        </NavLink>
        <NavLink href="/settings/workflow">
          Workflow
        </NavLink>
        <NavLink href="/settings/evaluation">
          Evaluation
        </NavLink>
      </nav>
      {children}
    </div>
  )
}
