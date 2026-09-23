import { Link } from "react-router-dom";

// Navy band under the top bar with the page title and, optionally, the
// page's sub-tabs (Stumps-style underline tabs). Used by every tab page and
// every Manage hub so they all read the same way.
export default function PageHeader({ title, subtitle, tabs, active, actions, children }) {
  return (
    <div className="bg-brand-navy text-white">
      <div className="max-w-5xl mx-auto px-4 pt-3">
        <div className="flex items-start justify-between gap-3 flex-wrap pb-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-black leading-tight">{title}</h1>
            {subtitle && <p className="text-sm text-white/60">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
        </div>
        {children}
        {tabs && tabs.length > 1 && (
          <nav aria-label={`${title} sections`} className="flex gap-1 overflow-x-auto scroll-touch -mx-1 px-1">
            {tabs.map((t) => {
              const on = t.key === active;
              return (
                <Link key={t.key} to={t.to} aria-current={on ? "page" : undefined}
                  className={`shrink-0 px-3 pt-1.5 pb-2.5 text-sm font-bold border-b-[3px] transition-colors duration-150 ${
                    on ? "text-white border-brand-gold" : "text-white/55 border-transparent hover:text-white/80"}`}>
                  {t.label}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}
