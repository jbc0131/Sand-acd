import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", {
  variants: {
    variant: {
      default: "bg-accent-soft text-accent",
      grey: "bg-muted-bg text-muted",
      amber: "bg-amber-bg text-amber-fg",
      chip: "rounded-md bg-chip-bg text-chip-fg font-mono",
      solid: "bg-accent text-accent-fg",
    },
  },
  defaultVariants: { variant: "default" },
});

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
