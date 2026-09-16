import * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";

export function CompactSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  defaultOption = true,
  className = "",
  side = "top",
}) {
  return (
    <SelectPrimitive.Root
      value={value || "__default"}
      onValueChange={(v) => onChange(v === "__default" ? "" : v)}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        aria-label={label}
        className={"compact-select-trigger " + className}
      >
        <SelectPrimitive.Value />
        <ChevronDown size={13} />
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="compact-select-content"
          position="popper"
          side={side}
          sideOffset={6}
          collisionPadding={8}
        >
          <SelectPrimitive.Viewport>
            {[
              ...(defaultOption
                ? [{ id: "__default", label: placeholder }]
                : []),
              ...options,
            ].map((o) => (
              <SelectPrimitive.Item
                key={o.id}
                value={o.id}
                className="compact-select-item"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check size={14} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
