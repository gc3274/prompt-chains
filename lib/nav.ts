// The side bar, in labelled groups. Every href is a top-level sibling, so
// exactly one item matches any page. "/" only sends you on to /prompt-chains.
export type NavItem = { href: string; label: string };
export type NavGroup = { label: string; items: readonly NavItem[] };

export const ADMIN_NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Chains",
    items: [
      { href: "/prompt-chains", label: "Chains & steps" },
      { href: "/chain-mix", label: "Chain mix" },
    ],
  },
  {
    label: "Generate",
    items: [
      { href: "/generate", label: "Run a chain" },
      { href: "/runs", label: "Runs" },
    ],
  },
];

export const ADMIN_NAV: readonly NavItem[] = ADMIN_NAV_GROUPS.flatMap((g) => g.items);

// "/" matches only itself; a section also matches its detail pages (/runs/<id>)
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
