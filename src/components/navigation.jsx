import { useState, useEffect, useRef } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

export function Navigation({ open, desktopOpen = true, onOpenChange, children }) {
  const keyboardClose = useRef(false);
  const [mobile, setMobile] = useState(
    () => matchMedia("(max-width:760px)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(max-width:760px)");
    const change = () => setMobile(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return mobile ? (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="navigation-sheet outline-none"
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => {
          keyboardClose.current = false;
          e.preventDefault();
          document.querySelector('[data-slot="sheet-content"]')?.focus();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (keyboardClose.current)
            document
              .querySelector('button[aria-label="项目与会话"]')
              ?.focus({ preventScroll: true });
        }}
        onKeyDownCapture={() => {
          keyboardClose.current = true;
        }}
        onEscapeKeyDown={() => {
          keyboardClose.current = true;
        }}
        onPointerDownCapture={() => {
          keyboardClose.current = false;
        }}
        onPointerDownOutside={() => {
          keyboardClose.current = false;
        }}
      >
        <SheetTitle className="sr-only">项目与会话</SheetTitle>
        <aside className="sidebar">{children}</aside>
      </SheetContent>
    </Sheet>
  ) : desktopOpen ? (
    <aside className="sidebar">{children}</aside>
  ) : null;
}
