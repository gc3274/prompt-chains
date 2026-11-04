"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { button } from "./ui";

const PANEL_ID = "admin-menu";

// Below xl the side bar folds into a top row with a Menu button that shows the
// nav under it; from xl up the button is hidden and the nav always shows. The nav
// is rendered on the server and passed in, so there is one nav at every width.
// Open is tied to the page it was opened on, so the next page starts closed.
export default function NavToggle({ brand, children }: { brand: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  // Drop an open from an earlier page while rendering, or coming back to it would reopen the menu
  if (openedOn !== null && openedOn !== pathname) setOpenedOn(null);
  const open = openedOn === pathname;
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Set when a link in the open menu is followed: the menu closes under it, so
  // focus goes back to the Menu button instead of dropping to the page
  const leftByLink = useRef(false);

  useEffect(() => {
    if (!leftByLink.current) return;
    leftByLink.current = false;
    buttonRef.current?.focus();
  }, [pathname]);

  function noteLink(e: MouseEvent) {
    if (open && e.target instanceof Element && e.target.closest("a")) leftByLink.current = true;
  }

  // Escape from anywhere in the bar closes the menu and goes back to its button
  function closeOnEscape(e: KeyboardEvent) {
    if (e.key !== "Escape" || !open) return;
    setOpenedOn(null);
    buttonRef.current?.focus();
  }

  return (
    <div
      onKeyDown={closeOnEscape}
      className="mx-auto flex w-full max-w-6xl flex-col px-4 sm:px-6 xl:min-h-full xl:max-w-none xl:px-3"
    >
      <div className="flex items-center gap-3 py-3 xl:px-3 xl:pt-5 xl:pb-4">
        {brand}
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-controls={PANEL_ID}
          onClick={() => setOpenedOn(open ? null : pathname)}
          className={`${button("secondary", "sm")} xl:hidden`}
        >
          Menu
        </button>
      </div>
      <div id={PANEL_ID} onClickCapture={noteLink} className={`${open ? "flex" : "hidden"} flex-1 flex-col gap-4 pb-4 xl:flex`}>
        {children}
      </div>
    </div>
  );
}
