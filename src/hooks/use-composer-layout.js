import { useEffect, useLayoutEffect } from "react";

// Keep text growth and scroll anchoring on the same viewport notification.
export function useComposerLayout({
  textareaRef,
  scroller,
  nearBottom,
  draft,
  sid,
  projectId,
}) {
  useLayoutEffect(() => {
    const resize = () => {
      const input = textareaRef.current;
      if (!input) return;
      input.style.height = "auto";
      input.style.height = input.scrollHeight + "px";
    };
    resize();
    window.addEventListener("pocket-viewport-change", resize);
    return () => window.removeEventListener("pocket-viewport-change", resize);
  }, [draft, sid, projectId]);
  useEffect(() => {
    let frame;
    const anchor = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (nearBottom.current && scroller.current)
          scroller.current.scrollTop = scroller.current.scrollHeight;
        const input = textareaRef.current;
        if (
          input &&
          document.activeElement === input &&
          input.selectionStart === input.selectionEnd &&
          input.selectionEnd === input.value.length
        )
          input.scrollTop = input.scrollHeight;
      });
    };
    window.addEventListener("pocket-viewport-change", anchor);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pocket-viewport-change", anchor);
    };
  }, []);
}
