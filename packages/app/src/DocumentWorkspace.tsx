import {
  AlertTriangle,
  Check,
  CheckCheck,
  ChevronDown,
  CodeXml,
  Eye,
  Loader2,
  MessageSquarePlus,
  Palette,
  PencilLine,
  RefreshCcw,
  StretchHorizontal,
  Type,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentEditorViewMode } from "./app-navigation";
import { RemoteSessionBanner } from "./components/RemoteSessionBanner";
import { Button } from "./components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
} from "./components/ui/select";
import { Textarea } from "./components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/ui/tooltip";
import { criticMarkdownHasReviewRail } from "./critic-markup";
import { cn } from "./lib/utils";
import { toHtml } from "./markdown";
import {
  getStoredRoughdraftEditorWidth,
  getStoredRoughdraftTextSize,
  getStoredRoughdraftThemePreference,
  roughdraftEditorWidthOptions,
  roughdraftTextSizeOptions,
  roughdraftThemeOptions,
  setStoredRoughdraftEditorWidth,
  setStoredRoughdraftTextSize,
  setStoredRoughdraftThemePreference,
  subscribeToRoughdraftAppearance,
  type RoughdraftEditorWidth,
  type RoughdraftTextSize,
  type RoughdraftThemePreference,
} from "./appearance";
import {
  type DocumentInteractionMode,
  type DocumentSaveController,
  type DocumentSaveState,
  PageCard,
} from "./PageCard";
import type { CompleteReviewOptions, Page, StorageBackend } from "./storage";

type DiskChangeState = "clean" | "changed" | "conflict" | "paused";
type ReviewHandoffState =
  | "idle"
  | "notifying"
  | "notified"
  | "undelivered"
  | "error";
type FileCopyAction = "path" | "filename" | "markdown" | "rich-text";

const documentInteractionModeOptions = [
  { value: "editing", label: "Editing", Icon: PencilLine },
  { value: "suggesting", label: "Suggesting", Icon: MessageSquarePlus },
  { value: "viewing", label: "Viewing", Icon: Eye },
] satisfies {
  value: DocumentInteractionMode;
  label: string;
  Icon: typeof Eye;
}[];

const conflictNoticeCopy: Record<
  Exclude<DiskChangeState, "clean">,
  {
    title: string;
    body: string;
  }
> = {
  changed: {
    title: "File changed on disk",
    body: "Roughdraft found a newer version of this file on disk. Reload to use that version, or overwrite it with your current draft.",
  },
  conflict: {
    title: "Save conflict",
    body: "This file changed on disk while you have unsaved edits. Autosave is paused so your draft will not overwrite those changes.",
  },
  paused: {
    title: "Autosave paused",
    body: "Keep editing locally, then reload from disk to discard your draft or overwrite the disk file when you are ready.",
  },
};

const fileCopyMenuOptions = [
  { action: "path", label: "Copy path" },
  { action: "filename", label: "Copy filename" },
  { action: "markdown", label: "Copy markdown" },
  { action: "rich-text", label: "Copy rich text" },
] satisfies {
  action: FileCopyAction;
  label: string;
}[];

async function writePlainTextToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

async function writeRichTextToClipboard(markdown: string) {
  const clipboardWithRichText = navigator.clipboard as Clipboard & {
    write?: Clipboard["write"];
  };

  if (clipboardWithRichText.write && typeof ClipboardItem !== "undefined") {
    await clipboardWithRichText.write([
      new ClipboardItem({
        "text/html": new Blob([toHtml(markdown)], { type: "text/html" }),
        "text/plain": new Blob([markdown], { type: "text/plain" }),
      }),
    ]);
    return;
  }

  await writePlainTextToClipboard(markdown);
}

function getSaveStatusViewModel(
  saveState: DocumentSaveState,
  diskChangeState: DiskChangeState,
) {
  if (diskChangeState === "conflict") {
    return {
      label: "Save conflict",
      ariaLabel: "Save conflict",
      tone: "warning" as const,
      Icon: AlertTriangle,
    };
  }

  if (diskChangeState === "changed") {
    return {
      label: "File changed on disk",
      ariaLabel: "File changed on disk",
      tone: "warning" as const,
      Icon: AlertTriangle,
    };
  }

  if (diskChangeState === "paused") {
    return {
      label: "Autosave paused",
      ariaLabel: "Autosave paused",
      tone: "warning" as const,
      Icon: AlertTriangle,
    };
  }

  if (saveState === "saving") {
    return {
      label: "Saving",
      ariaLabel: "Saving",
      tone: "neutral" as const,
      Icon: Loader2,
    };
  }

  if (saveState === "error") {
    return {
      label: "Save failed",
      ariaLabel: "Save failed",
      tone: "danger" as const,
      Icon: AlertTriangle,
    };
  }

  if (saveState === "unsaved") {
    return {
      label: "Unsaved changes",
      ariaLabel: "Unsaved changes",
      tone: "neutral" as const,
      Icon: Loader2,
    };
  }

  return {
    label: "Saved",
    ariaLabel: "Saved",
    tone: "success" as const,
    Icon: Check,
  };
}

export function DocumentSaveStatusIndicator({
  saveState,
  diskChangeState,
}: {
  saveState: DocumentSaveState;
  diskChangeState: DiskChangeState;
}) {
  const saveStatus = getSaveStatusViewModel(saveState, diskChangeState);
  const SaveStatusIcon = saveStatus.Icon;

  return (
    <span
      data-testid="document-save-status"
      role="status"
      aria-label={saveStatus.ariaLabel}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center text-stone-400 dark:text-stone-500",
        saveStatus.tone === "warning" && "text-amber-600 dark:text-amber-400",
        saveStatus.tone === "danger" && "text-red-600 dark:text-red-400",
      )}
    >
      <SaveStatusIcon
        data-testid="document-save-status-icon"
        className={cn(
          "size-3.5 shrink-0",
          (saveStatus.label === "Saving" ||
            saveStatus.label === "Unsaved changes") &&
            "animate-spin",
          saveStatus.label === "Saved" && "document-save-status-saved",
        )}
        aria-hidden="true"
      />
    </span>
  );
}

export function isReviewHandoffDisabled({
  saveState,
  documentDiskChangeState,
  reviewHandoffState,
}: {
  saveState: DocumentSaveState;
  documentDiskChangeState: DiskChangeState;
  reviewHandoffState: ReviewHandoffState;
}) {
  // Transient save states ("saving"/"unsaved") intentionally do NOT disable the
  // button. Disabling on them dims the whole control on every keystroke while
  // autosave debounces. Instead the button stays enabled and flushes the
  // pending save on click, so the agent still receives the latest content.
  return (
    saveState === "error" ||
    reviewHandoffState !== "idle" ||
    documentDiskChangeState !== "clean"
  );
}

interface DocumentWorkspaceProps {
  documentPage: Page | null;
  activeDocumentPath: string | null;
  documentFilenameLabel: string;
  documentEditorViewMode: DocumentEditorViewMode;
  onDocumentEditorViewModeChange: (mode: DocumentEditorViewMode) => void;
  onSaveDocument: (id: string, content: string) => Promise<void>;
  onDocumentSaveStateChange: (state: DocumentSaveState) => void;
  onDocumentDirtyStateChange: (isDirty: boolean) => void;
  onDocumentLocalContentChange: (markdown: string) => void;
  documentDiskChangeState: DiskChangeState;
  documentForceResetKey: string | null;
  onReloadDocumentFromDisk: () => void | Promise<void>;
  onKeepEditingWithoutAutosave: () => void;
  onOverwriteDocumentOnDisk: () => void | Promise<void>;
  onCompleteReview: (
    options?: CompleteReviewOptions,
  ) => Promise<{ delivered: boolean }>;
  openReviewRailByDefault?: boolean;
  backend: StorageBackend | null;
}

export function DocumentWorkspace({
  documentPage,
  activeDocumentPath,
  documentFilenameLabel,
  documentEditorViewMode,
  onDocumentEditorViewModeChange,
  onSaveDocument,
  onDocumentSaveStateChange,
  onDocumentDirtyStateChange,
  onDocumentLocalContentChange,
  documentDiskChangeState,
  documentForceResetKey,
  onReloadDocumentFromDisk,
  onKeepEditingWithoutAutosave,
  onOverwriteDocumentOnDisk,
  onCompleteReview,
  openReviewRailByDefault = false,
  backend,
}: DocumentWorkspaceProps) {
  const [documentInteractionMode, setDocumentInteractionMode] =
    useState<DocumentInteractionMode>("editing");
  const [saveState, setSaveState] = useState<DocumentSaveState>("saved");
  const [reviewHandoffState, setReviewHandoffState] =
    useState<ReviewHandoffState>("idle");
  const [reviewWatcherCount, setReviewWatcherCount] = useState(0);
  const [reviewHandoffPopoverOpen, setReviewHandoffPopoverOpen] =
    useState(false);
  const [fileCopyMenuOpen, setFileCopyMenuOpen] = useState(false);
  const [copiedFileAction, setCopiedFileAction] =
    useState<FileCopyAction | null>(null);
  const [themePreference, setThemePreference] =
    useState<RoughdraftThemePreference>(getStoredRoughdraftThemePreference);
  const [textSize, setTextSize] = useState<RoughdraftTextSize>(
    getStoredRoughdraftTextSize,
  );
  const [editorWidth, setEditorWidth] = useState<RoughdraftEditorWidth>(
    getStoredRoughdraftEditorWidth,
  );
  const [overallComment, setOverallComment] = useState("");
  const sawNoWatcherAfterNotifiedRef = useRef(false);
  const saveControllerRef = useRef<DocumentSaveController | null>(null);

  useEffect(
    () =>
      subscribeToRoughdraftAppearance(() => {
        setThemePreference(getStoredRoughdraftThemePreference());
        setTextSize(getStoredRoughdraftTextSize());
        setEditorWidth(getStoredRoughdraftEditorWidth());
      }),
    [],
  );

  const handleSaveStateChange = useCallback(
    (state: DocumentSaveState) => {
      setSaveState(state);
      onDocumentSaveStateChange(state);
    },
    [onDocumentSaveStateChange],
  );

  const shouldShowReviewRail = useCallback(
    (content?: string | null) =>
      openReviewRailByDefault ||
      (!!content && criticMarkdownHasReviewRail(content)),
    [openReviewRailByDefault],
  );
  const [documentHasComments, setDocumentHasComments] = useState(() =>
    shouldShowReviewRail(documentPage?.content),
  );

  useEffect(() => {
    setDocumentHasComments(shouldShowReviewRail(documentPage?.content));
  }, [documentPage?.content, shouldShowReviewRail]);

  useEffect(() => {
    const documentIdentity = `${activeDocumentPath ?? ""}:${documentPage?.id ?? ""}`;
    if (!documentIdentity) return;
    setReviewHandoffState("idle");
  }, [activeDocumentPath, documentPage?.id]);

  useEffect(() => {
    if (!backend?.getReviewWatchStatus || !activeDocumentPath) {
      setReviewWatcherCount(0);
      return;
    }

    let cancelled = false;
    const refreshWatchStatus = async () => {
      try {
        const status = await backend.getReviewWatchStatus?.(activeDocumentPath);
        if (!cancelled) {
          setReviewWatcherCount(status?.watcherCount ?? 0);
        }
      } catch {
        if (!cancelled) {
          setReviewWatcherCount(0);
        }
      }
    };

    void refreshWatchStatus();
    const interval = window.setInterval(refreshWatchStatus, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeDocumentPath, backend]);

  useEffect(() => {
    if (reviewHandoffState === "undelivered" && reviewWatcherCount > 0) {
      setReviewHandoffState("idle");
      return;
    }

    if (reviewHandoffState !== "notified") {
      sawNoWatcherAfterNotifiedRef.current = false;
      return;
    }

    if (reviewWatcherCount === 0) {
      sawNoWatcherAfterNotifiedRef.current = true;
      return;
    }

    if (sawNoWatcherAfterNotifiedRef.current) {
      sawNoWatcherAfterNotifiedRef.current = false;
      setReviewHandoffState("idle");
    }
  }, [reviewHandoffState, reviewWatcherCount]);

  useEffect(() => {
    if (!documentPage) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const isSaveShortcut =
        event.key.toLowerCase() === "s" &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey;

      if (!isSaveShortcut) return;

      event.preventDefault();
      event.stopPropagation();

      if (documentDiskChangeState !== "clean") return;

      void saveControllerRef.current?.flushSave();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [documentDiskChangeState, documentPage]);

  const handleCompleteReview = useCallback(
    async (options?: CompleteReviewOptions) => {
      if (!activeDocumentPath || reviewHandoffState === "notifying") return;

      setReviewHandoffState("notifying");
      try {
        // The button stays enabled while autosave is still pending, so make
        // sure any debounced edits are persisted before handing off.
        const flushResult = await saveControllerRef.current?.flushSave();
        if (flushResult && flushResult.status === "error") {
          throw flushResult.error;
        }

        const result = await onCompleteReview(options);
        if (result.delivered) {
          setReviewWatcherCount(0);
          setReviewHandoffState("notified");
          setOverallComment("");
          setReviewHandoffPopoverOpen(true);
        } else {
          setReviewWatcherCount(0);
          setReviewHandoffState("undelivered");
          setReviewHandoffPopoverOpen(true);
        }
      } catch (error) {
        console.error("Failed to complete review:", error);
        setReviewHandoffState("error");
        setReviewHandoffPopoverOpen(true);
      }
    },
    [activeDocumentPath, onCompleteReview, reviewHandoffState],
  );

  const handleCopyFileMenuAction = useCallback(
    async (action: FileCopyAction) => {
      if (!documentPage) return;

      const copyTextByAction: Record<
        Exclude<FileCopyAction, "rich-text">,
        string
      > = {
        path: activeDocumentPath ?? documentFilenameLabel,
        filename: documentFilenameLabel,
        markdown: documentPage.content,
      };

      try {
        if (action === "rich-text") {
          await writeRichTextToClipboard(documentPage.content);
        } else {
          await writePlainTextToClipboard(copyTextByAction[action]);
        }

        setCopiedFileAction(action);
        window.setTimeout(() => setCopiedFileAction(null), 1400);
        setFileCopyMenuOpen(false);
      } catch (error) {
        console.error("Failed to copy document data:", error);
      }
    },
    [activeDocumentPath, documentFilenameLabel, documentPage],
  );

  const editorViewModeToggleLabel =
    documentEditorViewMode === "rich-text"
      ? "Switch to code view"
      : "Switch to rich text view";
  const activeDocumentInteractionMode = documentInteractionModeOptions.find(
    (option) => option.value === documentInteractionMode,
  );
  const ActiveDocumentInteractionModeIcon =
    activeDocumentInteractionMode?.Icon ?? PencilLine;
  const activeThemeOption =
    roughdraftThemeOptions.find((option) => option.value === themePreference) ??
    roughdraftThemeOptions[0];
  const activeTextSizeOption =
    roughdraftTextSizeOptions.find((option) => option.value === textSize) ??
    roughdraftTextSizeOptions[1];
  const activeEditorWidthOption =
    roughdraftEditorWidthOptions.find(
      (option) => option.value === editorWidth,
    ) ?? roughdraftEditorWidthOptions[1];
  const conflictNotice =
    documentDiskChangeState === "clean"
      ? null
      : conflictNoticeCopy[documentDiskChangeState];
  const showReviewHandoffButton =
    !!activeDocumentPath &&
    (reviewWatcherCount > 0 || reviewHandoffState !== "idle");
  const reviewHandoffButtonLabel =
    reviewHandoffState === "notifying"
      ? "Sending"
      : reviewHandoffState === "notified"
        ? "Sent"
        : reviewHandoffState === "error" || reviewHandoffState === "undelivered"
          ? "Not sent"
          : "I'm done";
  const ReviewHandoffButtonIcon =
    reviewHandoffState === "notifying"
      ? Loader2
      : reviewHandoffState === "error" || reviewHandoffState === "undelivered"
        ? AlertTriangle
        : null;
  const reviewHandoffStatusTitle =
    reviewHandoffState === "undelivered"
      ? "No agent is watching now"
      : reviewHandoffState === "error"
        ? "Could not notify agent"
        : "Your agent is now working";
  const reviewHandoffStatusBody =
    reviewHandoffState === "undelivered"
      ? "The handoff was not delivered because the watcher is no longer connected."
      : reviewHandoffState === "error"
        ? "Roughdraft could not send the handoff. Check that the local server is still running."
        : "It will take the appropriate next action, including replying to comments, questions, and suggestions, and/or directly editing the doc.";
  const reviewHandoffDisabled = isReviewHandoffDisabled({
    saveState,
    documentDiskChangeState,
    reviewHandoffState,
  });
  const trimmedOverallComment = overallComment.trim();

  return (
    <div
      className={cn(
        "min-h-0 flex-1 overflow-y-auto px-8 pb-8 sm:px-12",
        conflictNotice ? "pt-40 sm:pt-28" : "pt-10",
      )}
    >
      <RemoteSessionBanner backend={backend} />
      <div
        className={cn(
          "fixed right-3 z-[60] flex max-w-[min(16rem,calc(100vw-1rem))] flex-col items-end gap-1.5",
          conflictNotice ? "top-[19rem] sm:top-[7rem]" : "top-3",
        )}
        data-testid="document-status-stack"
        data-document-status-stack="true"
      >
        <div className="flex max-w-full items-center justify-end gap-1.5">
          {showReviewHandoffButton ? (
            <Popover
              open={reviewHandoffPopoverOpen}
              onOpenChange={setReviewHandoffPopoverOpen}
            >
              <div className="relative flex items-center overflow-hidden rounded-[7px] shadow-[var(--rd-shadow-raised)] after:pointer-events-none after:absolute after:top-px after:right-8 after:bottom-px after:z-10 after:w-px after:bg-[var(--rd-primary-separator)] after:content-['']">
                <Button
                  type="button"
                  data-testid="review-handoff-button"
                  size="lg"
                  className="h-9 rounded-r-none rounded-l-[7px] border-0 bg-[var(--rd-primary)] px-3 text-sm font-bold text-[var(--rd-primary-foreground)] hover:bg-[var(--rd-primary-hover)] focus-visible:ring-[var(--rd-ring)]"
                  disabled={reviewHandoffDisabled}
                  onClick={() =>
                    void handleCompleteReview(
                      trimmedOverallComment
                        ? { overallComment: trimmedOverallComment }
                        : undefined,
                    )
                  }
                >
                  {ReviewHandoffButtonIcon ? (
                    <ReviewHandoffButtonIcon
                      className={cn(
                        "size-4",
                        reviewHandoffState === "notifying" && "animate-spin",
                      )}
                    />
                  ) : null}
                  {reviewHandoffButtonLabel}
                </Button>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      data-testid="review-handoff-comment-trigger"
                      size="icon-lg"
                      className="h-9 w-8 rounded-l-none rounded-r-[7px] border-0 bg-[var(--rd-primary)] text-[var(--rd-primary-foreground)] hover:bg-[var(--rd-primary-hover)] focus-visible:ring-[var(--rd-ring)]"
                      disabled={reviewHandoffDisabled}
                      aria-label="Add overall handoff comment"
                    >
                      <ChevronDown className="size-4" />
                    </Button>
                  }
                />
              </div>
              <PopoverContent
                aria-label={
                  reviewHandoffState === "idle"
                    ? "Review handoff comment"
                    : "Review handoff status"
                }
                data-testid={
                  reviewHandoffState === "idle"
                    ? "review-handoff-comment-popover"
                    : "review-handoff-status"
                }
              >
                {reviewHandoffState === "idle" ? (
                  <form
                    className="space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleCompleteReview({
                        overallComment: trimmedOverallComment,
                      });
                    }}
                  >
                    <div>
                      <Textarea
                        id="review-handoff-overall-comment"
                        data-testid="review-handoff-overall-comment"
                        aria-label="Overall comment"
                        placeholder="Overall comment"
                        value={overallComment}
                        onChange={(event) =>
                          setOverallComment(event.currentTarget.value)
                        }
                        maxLength={4000}
                        rows={4}
                        className="min-h-24 resize-y"
                      />
                    </div>
                    <Button
                      type="submit"
                      data-testid="review-handoff-submit-comment"
                      size="lg"
                      className="w-full rounded-[7px] bg-[var(--rd-primary)] text-sm font-bold text-[var(--rd-primary-foreground)] hover:bg-[var(--rd-primary-hover)] focus-visible:ring-[var(--rd-ring)]"
                      disabled={!trimmedOverallComment}
                    >
                      <CheckCheck className="size-4" />
                      Submit with comment
                    </Button>
                  </form>
                ) : (
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--rd-primary)] text-[var(--rd-primary-foreground)]">
                      {reviewHandoffState === "notifying" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : reviewHandoffState === "error" ||
                        reviewHandoffState === "undelivered" ? (
                        <AlertTriangle className="size-4" />
                      ) : (
                        <CheckCheck className="size-4" />
                      )}
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-stone-950 dark:text-slate-50">
                        {reviewHandoffStatusTitle}
                      </div>
                      <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-slate-300">
                        {reviewHandoffStatusBody}
                      </p>
                    </div>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      </div>
      {conflictNotice ? (
        <div
          data-testid="file-conflict-notice"
          role="status"
          aria-label="File conflict"
          className="fixed top-3 left-1/2 z-50 flex w-[min(calc(100vw-1rem),52rem)] -translate-x-1/2 flex-col gap-3 rounded-[8px] border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-3 py-3 text-amber-950 dark:text-amber-100 shadow-[0_14px_40px_rgba(120,53,15,0.18)] dark:shadow-[0_14px_40px_rgba(0,0,0,0.4)] sm:flex-row sm:items-center sm:justify-between sm:px-4"
        >
          <div className="flex min-w-0 items-start gap-2.5">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-5">
                {conflictNotice.title}
              </div>
              <div className="mt-0.5 text-xs leading-5 text-amber-900 dark:text-amber-200">
                {conflictNotice.body}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
            <Button
              type="button"
              data-testid="file-conflict-action-reload"
              variant="ghost"
              size="sm"
              className="h-8 rounded-[7px] bg-white/55 dark:bg-white/10 px-2 text-xs text-amber-950 dark:text-amber-100 hover:bg-white dark:hover:bg-white/20"
              onClick={() => void onReloadDocumentFromDisk()}
            >
              <RefreshCcw className="size-3.5" />
              Reload from disk
            </Button>
            {documentDiskChangeState !== "paused" ? (
              <Button
                type="button"
                data-testid="file-conflict-action-keep-editing"
                variant="ghost"
                size="sm"
                className="h-8 rounded-[7px] bg-white/55 dark:bg-white/10 px-2 text-xs text-amber-950 dark:text-amber-100 hover:bg-white dark:hover:bg-white/20"
                onClick={onKeepEditingWithoutAutosave}
              >
                <PencilLine className="size-3.5" />
                Keep editing with autosave paused
              </Button>
            ) : null}
            <Button
              type="button"
              data-testid="file-conflict-action-overwrite"
              variant="ghost"
              size="sm"
              className="h-8 rounded-[7px] bg-amber-900 dark:bg-amber-600 px-2 text-xs text-white hover:bg-amber-800 dark:hover:bg-amber-500"
              onClick={() => void onOverwriteDocumentOnDisk()}
            >
              <Upload className="size-3.5" />
              Overwrite disk file
            </Button>
          </div>
        </div>
      ) : null}
      <div className="document-workspace-inner mx-auto min-h-full w-full">
        {documentPage ? (
          <div
            data-testid="document-page-header"
            className={cn(
              "document-page-shell mb-2 flex flex-col gap-6 text-[0.62rem] font-medium tracking-[0.01em] text-stone-400 min-[1100px]:grid min-[1100px]:items-start min-[1100px]:justify-between min-[1100px]:gap-8",
              !documentHasComments &&
                "document-page-shell-no-comments min-[1100px]:justify-center",
            )}
          >
            <div className="document-page-main w-full min-w-0">
              <div className="flex w-full flex-wrap items-center gap-1.5 px-1">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        data-testid="document-editor-view-toggle"
                        className="grid shrink-0 grid-cols-2 rounded-[999px] bg-[var(--rd-control)] px-[2px] pt-[3px] pb-[2px] shadow-[inset_0_1px_0_rgba(255,255,255,0.42)]"
                      >
                        <span
                          className={`flex w-[1.375rem] items-center justify-center rounded-full py-[2px] transition ${
                            documentEditorViewMode === "rich-text"
                              ? "bg-[var(--rd-control-active)] text-[var(--rd-app-foreground)] shadow-[0_1px_2px_rgba(41,52,38,0.16)]"
                              : "text-[var(--rd-muted-foreground)]"
                          }`}
                        >
                          <Eye className="size-[0.75rem]" />
                        </span>
                        <span
                          className={`flex w-[1.375rem] items-center justify-center rounded-full py-[2px] transition ${
                            documentEditorViewMode === "code"
                              ? "bg-[var(--rd-control-active)] text-[var(--rd-app-foreground)] shadow-[0_1px_2px_rgba(41,52,38,0.16)]"
                              : "text-[var(--rd-muted-foreground)]"
                          }`}
                        >
                          <CodeXml className="size-[0.75rem]" />
                        </span>
                      </button>
                    }
                    aria-label={editorViewModeToggleLabel}
                    onClick={() =>
                      onDocumentEditorViewModeChange(
                        documentEditorViewMode === "rich-text"
                          ? "code"
                          : "rich-text",
                      )
                    }
                  />
                  <TooltipContent>{editorViewModeToggleLabel}</TooltipContent>
                </Tooltip>
                <Popover
                  open={fileCopyMenuOpen}
                  onOpenChange={setFileCopyMenuOpen}
                >
                  <PopoverTrigger
                    render={
                      <button
                        type="button"
                        data-testid="document-file-menu-trigger"
                        className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full px-1 py-0.5 font-mono text-[0.7rem] tracking-[0.01em] text-[var(--rd-muted-foreground)] outline-none transition hover:bg-[var(--rd-hover)] hover:text-[var(--rd-app-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--rd-ring)]"
                        title={documentFilenameLabel}
                        aria-label="Document file actions"
                      >
                        <span className="min-w-0 truncate">
                          {documentFilenameLabel}
                        </span>
                        <ChevronDown
                          className="size-[0.62rem] shrink-0"
                          aria-hidden="true"
                        />
                      </button>
                    }
                  />
                  <PopoverContent
                    aria-label="Document file actions"
                    data-testid="document-file-menu"
                    className="w-44 p-1"
                    align="start"
                  >
                    <div className="flex flex-col">
                      {fileCopyMenuOptions.map(({ action, label }) => (
                        <button
                          key={action}
                          type="button"
                          data-testid={`document-file-menu-${action}`}
                          className="flex h-8 items-center justify-between rounded-md px-2 text-left text-[0.72rem] leading-none text-[var(--rd-menu-foreground)] outline-none transition hover:bg-[var(--rd-menu-hover)] focus-visible:bg-[var(--rd-menu-hover)]"
                          onClick={() => void handleCopyFileMenuAction(action)}
                        >
                          <span>{label}</span>
                          {copiedFileAction === action ? (
                            <Check className="size-3 text-[var(--rd-muted-foreground)]" />
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <DocumentSaveStatusIndicator
                  saveState={saveState}
                  diskChangeState={documentDiskChangeState}
                />
                <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1">
                  <Select<RoughdraftThemePreference>
                    value={themePreference}
                    onValueChange={(value) => {
                      if (value) {
                        setThemePreference(value);
                        setStoredRoughdraftThemePreference(value);
                      }
                    }}
                  >
                    <SelectTrigger
                      data-testid="document-theme-trigger"
                      aria-label="Theme"
                      className="h-[1.5rem] max-w-[8.5rem] px-1 font-mono text-[0.7rem] leading-[1.25rem] font-normal tracking-[0.01em] text-[var(--rd-muted-foreground)] hover:text-[var(--rd-app-foreground)]"
                    >
                      <Palette className="size-[0.68rem]" />
                      <span className="truncate">
                        {activeThemeOption.label}
                      </span>
                    </SelectTrigger>
                    <SelectContent className="w-40">
                      {roughdraftThemeOptions.map(
                        ({ value, label, swatch }) => (
                          <SelectItem key={value} value={value} label={label}>
                            <span
                              className="size-2.5 shrink-0 rounded-full border border-[var(--rd-menu-border)]"
                              style={{ background: swatch }}
                              aria-hidden="true"
                            />
                            <SelectItemText>{label}</SelectItemText>
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                  <Select<RoughdraftTextSize>
                    value={textSize}
                    onValueChange={(value) => {
                      if (value) {
                        setTextSize(value);
                        setStoredRoughdraftTextSize(value);
                      }
                    }}
                  >
                    <SelectTrigger
                      data-testid="document-text-size-trigger"
                      aria-label="Editor text size"
                      className="h-[1.5rem] max-w-[5.75rem] px-1 font-mono text-[0.7rem] leading-[1.25rem] font-normal tracking-[0.01em] text-[var(--rd-muted-foreground)] hover:text-[var(--rd-app-foreground)]"
                    >
                      <Type className="size-[0.68rem]" />
                      <span className="truncate">
                        {activeTextSizeOption.label}
                      </span>
                    </SelectTrigger>
                    <SelectContent className="w-28">
                      {roughdraftTextSizeOptions.map(({ value, label }) => (
                        <SelectItem key={value} value={value} label={label}>
                          <SelectItemText>{label}</SelectItemText>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select<RoughdraftEditorWidth>
                    value={editorWidth}
                    onValueChange={(value) => {
                      if (value) {
                        setEditorWidth(value);
                        setStoredRoughdraftEditorWidth(value);
                      }
                    }}
                  >
                    <SelectTrigger
                      data-testid="document-width-trigger"
                      aria-label="Editor width"
                      className="h-[1.5rem] max-w-[6.5rem] px-1 font-mono text-[0.7rem] leading-[1.25rem] font-normal tracking-[0.01em] text-[var(--rd-muted-foreground)] hover:text-[var(--rd-app-foreground)]"
                    >
                      <StretchHorizontal className="size-[0.68rem]" />
                      <span className="truncate">
                        {activeEditorWidthOption.label}
                      </span>
                    </SelectTrigger>
                    <SelectContent className="w-32">
                      {roughdraftEditorWidthOptions.map(({ value, label }) => (
                        <SelectItem key={value} value={value} label={label}>
                          <SelectItemText>{label}</SelectItemText>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select<DocumentInteractionMode>
                    value={documentInteractionMode}
                    onValueChange={(value) => {
                      if (value) setDocumentInteractionMode(value);
                    }}
                  >
                    <SelectTrigger
                      data-testid="document-mode-trigger"
                      aria-label="Document mode"
                      className="h-[1.5rem] px-1 font-mono text-[0.7rem] leading-[1.25rem] font-normal tracking-[0.01em] text-[var(--rd-muted-foreground)] hover:text-[var(--rd-app-foreground)]"
                    >
                      <ActiveDocumentInteractionModeIcon className="size-[0.68rem]" />
                      <span className="truncate">
                        {activeDocumentInteractionMode?.label}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {documentInteractionModeOptions.map(
                        ({ value, label, Icon }) => (
                          <SelectItem key={value} value={value} label={label}>
                            <Icon className="size-3 text-[var(--rd-muted-foreground)]" />
                            <SelectItemText>{label}</SelectItemText>
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            {documentHasComments ? (
              <div
                className="document-comment-rail pointer-events-none invisible hidden min-[1100px]:block"
                aria-hidden="true"
              />
            ) : null}
          </div>
        ) : null}
        {documentPage ? (
          backend ? (
            <PageCard
              key={`${documentPage.id}:${activeDocumentPath ?? ""}`}
              page={documentPage}
              activeDocumentPath={activeDocumentPath}
              selected
              onSave={onSaveDocument}
              onSaveStateChange={handleSaveStateChange}
              editorViewMode={documentEditorViewMode}
              interactionMode={documentInteractionMode}
              openReviewRailByDefault={openReviewRailByDefault}
              backend={backend}
              onCommentRailPresenceChange={setDocumentHasComments}
              onDirtyStateChange={onDocumentDirtyStateChange}
              onLocalContentChange={onDocumentLocalContentChange}
              onSaveControllerChange={(controller) => {
                saveControllerRef.current = controller;
              }}
              saveBlocked={documentDiskChangeState !== "clean"}
              forceResetKey={documentForceResetKey}
            />
          ) : null
        ) : (
          <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-500 dark:text-slate-400">
            Open a markdown file to begin.
          </div>
        )}
      </div>
    </div>
  );
}
