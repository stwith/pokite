import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  LoaderCircle,
  Check,
  CircleHelp,
  CircleAlert,
  Circle,
} from "lucide-react";

export function IconButton({ label, children, ...props }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="icon"
      aria-label={label}
      {...props}
    >
      {children}
    </Button>
  );
}
export function ComposerButton({ inputRef, onPress, children, ...props }) {
  const handledTouch = useRef(false),
    preserveFocus = useRef(false);
  return (
    <Button
      type="button"
      {...props}
      onPointerDown={(e) => {
        handledTouch.current = false;
        preserveFocus.current = document.activeElement === inputRef.current;
        if (preserveFocus.current) e.preventDefault();
      }}
      onPointerUp={(e) => {
        if (e.pointerType === "touch" && preserveFocus.current) {
          e.preventDefault();
          handledTouch.current = true;
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX >= r.left &&
            e.clientX <= r.right &&
            e.clientY >= r.top &&
            e.clientY <= r.bottom
          )
            onPress();
        }
      }}
      onPointerCancel={() => {
        handledTouch.current = true;
      }}
      onClick={(e) => {
        if (e.detail === 0 || !handledTouch.current) onPress();
      }}
    >
      {children}
    </Button>
  );
}
export function SessionStatus({ status, unread }) {
  if (status === "running")
    return (
      <LoaderCircle
        className="session-status running spin"
        aria-hidden="true"
      />
    );
  if (unread)
    return (
      <span className="session-status unread-marker" aria-hidden="true">
        <i />
      </span>
    );
  const Icon =
    status === "completed"
      ? Check
      : status === "waiting"
        ? CircleHelp
        : ["failed", "interrupted"].includes(status)
          ? CircleAlert
          : Circle;
  return <Icon className={"session-status " + status} aria-hidden="true" />;
}
