"use client";

import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const Sheet = SheetPrimitive.Root;

function SheetContent({
  className,
  children,
  side = "right",
  modal = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & { side?: "right" | "left"; modal?: boolean }) {
  return (
    <SheetPrimitive.Portal>
      {modal && <SheetPrimitive.Overlay className="fixed inset-0 z-40 bg-black/30" />}
      <SheetPrimitive.Content
        className={cn(
          "fixed inset-y-0 z-50 flex h-full w-full flex-col border-border bg-panel text-text shadow-float sm:max-w-md",
          side === "right" ? "right-0 sm:border-l" : "left-0 sm:border-r",
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute top-4 right-4 rounded-md p-1 text-muted hover:bg-muted-bg" aria-label="Close">
          <XIcon className="size-4" />
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

const SheetTitle = SheetPrimitive.Title;
const SheetDescription = SheetPrimitive.Description;

export { Sheet, SheetContent, SheetTitle, SheetDescription };
