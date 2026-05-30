import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "@/lib/utils";

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  side = "bottom",
  sideOffset = 8,
  align = "end",
  alignOffset = 0,
  children,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-[70]"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "z-50 w-80 max-w-[calc(100vw-1.5rem)] origin-(--transform-origin) rounded-lg border border-[var(--rd-menu-border)] bg-[var(--rd-menu-background)] p-4 text-sm text-[var(--rd-menu-foreground)] shadow-[var(--rd-shadow-popover)] outline-none data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95 data-[starting-style]:animate-in data-[starting-style]:fade-in-0 data-[starting-style]:zoom-in-95",
            className,
          )}
          {...props}
        >
          {children}
          <PopoverPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%-1px)] rotate-45 rounded-[2px] border-t border-l border-[var(--rd-menu-border)] bg-[var(--rd-menu-background)] data-[side=bottom]:top-1 data-[side=top]:-bottom-2.5" />
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverContent, PopoverTrigger };
