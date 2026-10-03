import { t } from "../../lib/i18n.js";
import * as React from "react";
import { Dialog as Primitive } from "radix-ui";
import { X } from "lucide-react";
import { Button } from "./button";
export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogTitle = Primitive.Title;
export const DialogDescription = Primitive.Description;
export function DialogContent({ children, closeLabel = t("关闭连接弹窗"), ...props }) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="connection-overlay" />
      <Primitive.Content className="connection-dialog" {...props}>
        {children}
        <Primitive.Close asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="connection-close"
            aria-label={closeLabel}
          >
            <X size={18} />
          </Button>
        </Primitive.Close>
      </Primitive.Content>
    </Primitive.Portal>
  );
}
