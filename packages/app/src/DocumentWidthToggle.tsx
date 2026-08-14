import { FoldHorizontal, UnfoldHorizontal } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/ui/tooltip";
import { type DocumentWidth, useDocumentWidth } from "./document-width";

const otherWidth: Record<DocumentWidth, DocumentWidth> = {
  comfortable: "wide",
  wide: "comfortable",
};

const widthLabel: Record<DocumentWidth, string> = {
  comfortable: "comfortable width",
  wide: "full width",
};

const segmentClass = (active: boolean) =>
  `flex w-[1.375rem] items-center justify-center rounded-full py-[2px] transition ${
    active
      ? "bg-[#FFFDFC] dark:bg-slate-600 text-stone-700 dark:text-white shadow-[0_1px_2px_rgba(41,37,36,0.12)]"
      : "text-stone-500 dark:text-slate-400"
  }`;

export function DocumentWidthToggle() {
  const [width, setWidth] = useDocumentWidth();
  const toggleLabel = `Switch to ${widthLabel[otherWidth[width]]}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-testid="document-width-toggle"
            data-doc-width={width}
            className="grid shrink-0 grid-cols-2 rounded-[999px] bg-[#E8E3DB] dark:bg-slate-800 px-[2px] pt-[3px] pb-[2px] shadow-[inset_0_1px_0_rgba(255,251,245,0.72)] dark:border-b dark:border-b-slate-800 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
          >
            <span className={segmentClass(width === "comfortable")}>
              <FoldHorizontal className="size-[0.75rem]" />
            </span>
            <span className={segmentClass(width === "wide")}>
              <UnfoldHorizontal className="size-[0.75rem]" />
            </span>
          </button>
        }
        aria-label={toggleLabel}
        onClick={() => setWidth(otherWidth[width])}
      />
      <TooltipContent>{toggleLabel}</TooltipContent>
    </Tooltip>
  );
}
