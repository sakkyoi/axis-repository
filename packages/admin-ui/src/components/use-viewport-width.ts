import { useEffect, useState } from "react";

/**
 * How wide the window is, as something a layout can decide with.
 *
 * A media query in CSS cannot answer a question about which component to
 * render -- only about how to paint one that is already there -- and rendering
 * both and hiding one puts the same content on the page twice.
 */
export function useViewportWidth(fallback: number): number {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? fallback : window.innerWidth));

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return width;
}
