import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

interface SplitPaneProps {
  left: ReactNode;
  right: ReactNode;
  defaultLeftWidth?: number;
  minLeft?: number;
  minRight?: number;
}

export default function SplitPane({
  left,
  right,
  defaultLeftWidth = 200,
  minLeft = 160,
  minRight = 300,
}: SplitPaneProps) {
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const clampWidth = useCallback(
    (w: number) => {
      const container = containerRef.current;
      if (!container) return w;
      const max = container.getBoundingClientRect().width - minRight - 4; // 4px for divider
      return Math.max(minLeft, Math.min(w, max));
    },
    [minLeft, minRight]
  );

  // Clamp on mount
  useEffect(() => {
    setLeftWidth((w) => clampWidth(w));
  }, [clampWidth]);

  // ResizeObserver: reclamp when container size changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      setLeftWidth((w) => clampWidth(w));
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [clampWidth]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setLeftWidth(clampWidth(x));
    };

    const onMouseUp = () => setDragging(false);

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragging, clampWidth]);

  return (
    <div
      ref={containerRef}
      className="flex flex-1 min-h-0 h-full"
      style={{ userSelect: dragging ? "none" : undefined }}
    >
      {/* Left panel */}
      <div
        className="flex-shrink-0 flex flex-col min-h-0"
        style={{ width: leftWidth }}
      >
        {left}
      </div>

      {/* Divider */}
      <div
        onMouseDown={onMouseDown}
        className={`flex-shrink-0 w-1 cursor-col-resize transition-colors self-stretch ${
          dragging
            ? "bg-brand-500"
            : "bg-gray-800 hover:bg-brand-500/60"
        }`}
        style={{ cursor: "col-resize" }}
      />

      {/* Right panel */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {right}
      </div>
    </div>
  );
}
