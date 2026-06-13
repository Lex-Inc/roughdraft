import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

function Select<Value, Multiple extends boolean | undefined = false>({
  ...props
}: SelectPrimitive.Root.Props<Value, Multiple>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectTrigger({
  className,
  children,
  ...props
}: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "inline-flex items-center justify-between gap-1 rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-stone-300/70 dark:focus-visible:ring-slate-600/70 disabled:pointer-events-none disabled:opacity-50 data-[popup-open]:ring-2 data-[popup-open]:ring-stone-300/70 dark:data-[popup-open]:ring-slate-600/70",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        data-slot="select-icon"
        className="flex shrink-0 items-center text-current transition-transform data-[popup-open]:rotate-180"
      >
        <ChevronDown className="size-[0.62rem]" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("truncate", className)}
      {...props}
    />
  );
}

function SelectContent({
  className,
  side = "bottom",
  sideOffset = 5,
  align = "end",
  children,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        align={align}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "z-50 min-w-32 origin-(--transform-origin) rounded-lg border border-[#DCD6CC] dark:border-slate-700 bg-[#FFFDFC] dark:bg-slate-800 p-1 text-xs text-stone-700 dark:text-slate-300 shadow-[0_12px_32px_rgba(57,47,38,0.16)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.4)] data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95 data-[starting-style]:animate-in data-[starting-style]:fade-in-0 data-[starting-style]:zoom-in-95",
            className,
          )}
          {...props}
        >
          <SelectPrimitive.List data-slot="select-list">
            {children}
          </SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[0.72rem] leading-none outline-none transition select-none data-[highlighted]:bg-[#EEE9E1] dark:data-[highlighted]:bg-slate-700 data-[highlighted]:text-stone-900 dark:data-[highlighted]:text-slate-100 data-[selected]:text-stone-900 dark:data-[selected]:text-slate-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.ItemIndicator
        data-slot="select-item-indicator"
        className="ml-auto flex size-3 items-center justify-center text-stone-700 dark:text-slate-300"
      >
        <Check className="size-3" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

function SelectItemText({
  className,
  ...props
}: SelectPrimitive.ItemText.Props) {
  return (
    <SelectPrimitive.ItemText
      data-slot="select-item-text"
      className={cn("truncate", className)}
      {...props}
    />
  );
}

export {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectItemText,
};
