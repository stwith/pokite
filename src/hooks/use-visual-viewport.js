import { useEffect } from "react";

export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    let frame = 0,
      until = 0,
      last = "";
    // Safari can publish the final keyboard geometry after its last resize event.
    // Sample through the transition, without ignoring zoom or forcing document scroll.
    const sample = () => {
      frame = 0;
      const height = viewport?.height ?? window.innerHeight,
        width = viewport?.width ?? window.innerWidth;
      const top = Math.max(0, viewport?.offsetTop || 0),
        left = Math.max(0, viewport?.offsetLeft || 0),
        scale = viewport?.scale || 1;
      if (height > 0 && width > 0) {
        const geometry = [height, width, top, left].join(":");
        if (geometry !== last) {
          root.style.setProperty("--viewport-height", height + "px");
          root.style.setProperty("--viewport-width", width + "px");
          root.style.setProperty("--viewport-top", top + "px");
          root.style.setProperty("--viewport-left", left + "px");
          last = geometry;
          window.dispatchEvent(new Event("pocket-viewport-change"));
        }
        root.dataset.editing = document.activeElement?.matches(
          'input,textarea,[contenteditable="true"]',
        )
          ? "true"
          : "false";
        root.dataset.keyboard =
          Math.max(window.innerHeight, root.clientHeight) - height * scale > 100
            ? "open"
            : "closed";
        root.dataset.viewportCompact = height < 300 ? "true" : "false";
      }
      if (performance.now() < until && !document.hidden)
        frame = requestAnimationFrame(sample);
    };
    const update = () => {
      until = performance.now() + 1000;
      if (!frame && !document.hidden) frame = requestAnimationFrame(sample);
    };
    const interact=e=>{if(e.target instanceof Element&&e.target.closest('input,textarea,select,button'))update()};
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.addEventListener("pageshow", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    document.addEventListener("visibilitychange", update);
    document.addEventListener('pointerup',interact,{passive:true});
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener("pageshow", update);
      document.removeEventListener("visibilitychange", update);
      document.removeEventListener('pointerup',interact);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      document.documentElement.style.removeProperty("--viewport-height");
      document.documentElement.style.removeProperty("--viewport-top");
      root.style.removeProperty("--viewport-width");
      root.style.removeProperty("--viewport-left");
      delete root.dataset.editing;
      delete root.dataset.viewportCompact;
      delete document.documentElement.dataset.keyboard;
    };
  }, []);
}
