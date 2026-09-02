import { LayoutDashboard, Plane, Radar, Workflow, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Primary route table — consumed by the Sidebar, MobileNav and Header
 * breadcrumbs. `/flights` is built by the features package in parallel;
 * remove the entry if that page does not land.
 */
export const NAV: readonly NavItem[] = [
  { href: "/", label: "Command Center", icon: LayoutDashboard },
  { href: "/operations", label: "Operations", icon: Radar },
  { href: "/automation", label: "Automation", icon: Workflow },
  { href: "/flights", label: "Flights", icon: Plane },
];

/** Whether a nav entry is the current route. `/properties/*` belongs to `/`. */
export function isNavActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/properties");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export interface Crumb {
  label: string;
  href?: string;
}

const SECTION_LEAVES: Record<string, string> = {
  properties: "Property",
  new: "New",
  edit: "Edit",
};

/**
 * Breadcrumb trail for a pathname. The last entry is the leaf (no href).
 * `/properties/<id>` → Command Center / Property; the page can replace the
 * leaf label via the header-title context.
 */
export function crumbsFor(pathname: string): Crumb[] {
  const clean = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  const exact = NAV.find((n) => n.href === clean);
  if (exact) return [{ label: exact.label }];

  const segments = clean.split("/").filter(Boolean);
  const root = NAV.find((n) => n.href !== "/" && isNavActive(n.href, clean)) ?? NAV[0];
  const crumbs: Crumb[] = [{ label: root.label, href: root.href }];

  const rest = root.href === "/" ? segments : segments.slice(1);
  if (rest.length === 0) return [{ label: root.label }];

  const head = rest[0];
  const leaf =
    SECTION_LEAVES[rest[rest.length - 1]] ??
    SECTION_LEAVES[head] ??
    head.charAt(0).toUpperCase() + head.slice(1);
  crumbs.push({ label: leaf });
  return crumbs;
}
