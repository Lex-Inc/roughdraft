import type { Editor } from "@tiptap/react";
import { Check, Reply, X } from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CommentEditorList,
  type CommentActionDefinition,
  type CommentActionsRenderContext,
  type CommentContentRenderContext,
} from "./CommentEditorList";
import type {
  CriticChangeAttrs,
  CriticChangeKind,
  CriticComment,
} from "./critic-markup";
import {
  buildCommentThreadRailItems,
  type CommentGroupAnchor,
  type CommentThreadRailItem,
  getPreferredCommentId,
  getRootThreadIdForCommentId,
  normalizeCommentMeasurement,
  resolveAnchoredRailLayouts,
} from "./document-comments";
import { SUGGESTED_PARAGRAPH_SENTINEL } from "./editor-extensions";
import { cn } from "./lib/utils";
import type { DraftSuggestionState } from "./PageCard";

const SUGGESTION_QUOTE_PREVIEW_LIMIT = 140;

export interface CriticChangeRailItem {
  changeId: string;
  change: CriticChangeAttrs;
  kind: CriticChangeKind;
  oldText: string;
  newText: string;
  commentIds: string[];
  anchorTop: number;
  anchorBottom: number;
}

interface DocumentReviewRailProps {
  commentGroups: CommentGroupAnchor[];
  comments: Map<string, CriticComment>;
  suggestions: CriticChangeRailItem[];
  selectedCommentId: string | null;
  hoveredCommentId: string | null;
  selectedChangeId: string | null;
  hoveredChangeId: string | null;
  contentHeight: number;
  className?: string;
  layout?: "anchored" | "flow";
  testId?: string;
  onDeleteComment: (commentId: string) => void;
  onUpdateComment: (commentId: string, nextContent: string) => void;
  onReplyComment: (commentId: string) => void;
  onSelectComment: (commentId: string) => void;
  onFocusComment: (commentId: string) => void;
  onHoverComment: (commentId: string | null) => void;
  onAcceptSuggestion: (changeId: string) => void;
  onRejectSuggestion: (changeId: string) => void;
  onReplySuggestion: (changeId: string) => void;
  onSelectSuggestion: (changeId: string) => void;
  onFocusSuggestion: (changeId: string) => void;
  onHoverSuggestion: (changeId: string | null) => void;
  pendingFocusCommentId?: string | null;
  newCommentDraftIds?: string[];
  onAutoFocusComment?: (commentId: string) => void;
  draftSuggestion?: DraftSuggestionState | null;
  onDraftSuggestionTextChange?: (text: string) => void;
  onApplyDraftSuggestion?: () => void;
  onCancelDraftSuggestion?: () => void;
  editor?: Editor | null;
}

function railLayoutItemClass(layout: "anchored" | "flow") {
  return cn(
    "left-0 right-0 rounded-xl border border-transparent bg-transparent shadow-none transition-all duration-200 ease-out will-change-transform",
    layout === "anchored" ? "absolute" : "relative",
  );
}

function railLayoutItemStyle(
  layout: "anchored" | "flow",
  railTop: number,
): CSSProperties | undefined {
  return layout === "anchored" ? { top: railTop } : undefined;
}

function getSuggestionPreview(suggestion: CriticChangeRailItem) {
  const oldText = suggestion.oldText.trim();
  const newText = suggestion.newText.trim();

  if (suggestion.kind === "addition") return newText || "Inserted text";
  if (suggestion.kind === "deletion") return oldText || "Deleted text";
  if (oldText && newText) return `${oldText} -> ${newText}`;
  return oldText || newText || "Changed text";
}

function getSuggestionRootComment(
  suggestion: CriticChangeRailItem,
): CriticComment {
  return {
    id: suggestion.changeId,
    content: getSuggestionPreview(suggestion),
    createdAt: suggestion.change.createdAt,
    authorType: suggestion.change.authorType,
    authorId: suggestion.change.authorId,
  };
}

function truncateSuggestionQuote(text: string) {
  if (text.length <= SUGGESTION_QUOTE_PREVIEW_LIMIT) return text;
  return `${text.slice(0, SUGGESTION_QUOTE_PREVIEW_LIMIT)}...`;
}

function renderQuotedSuggestionText(text: string, fallback: string) {
  const withoutParagraphSentinels = text.replaceAll(
    SUGGESTED_PARAGRAPH_SENTINEL,
    "",
  );
  const fullDisplayText =
    withoutParagraphSentinels.trim() ||
    (text.includes(SUGGESTED_PARAGRAPH_SENTINEL)
      ? "Inserted paragraph"
      : fallback);
  const displayText = truncateSuggestionQuote(fullDisplayText);

  return (
    <span className="italic text-slate-600 dark:text-slate-400">
      "{displayText}"
    </span>
  );
}

function SuggestionCommentContent({
  suggestion,
}: {
  suggestion: CriticChangeRailItem;
}) {
  const oldText = suggestion.oldText.trim();
  const newText = suggestion.newText.trim();

  if (suggestion.kind === "addition") {
    return (
      <>
        <span className="font-semibold text-slate-800 dark:text-slate-200">
          Insert:
        </span>{" "}
        {renderQuotedSuggestionText(newText, "Inserted text")}
      </>
    );
  }

  if (suggestion.kind === "deletion") {
    return (
      <>
        <span className="font-semibold text-slate-800 dark:text-slate-200">
          Delete:
        </span>{" "}
        {renderQuotedSuggestionText(oldText, "Deleted text")}
      </>
    );
  }

  return (
    <>
      <span className="font-semibold text-slate-800 dark:text-slate-200">
        Replace:
      </span>{" "}
      {renderQuotedSuggestionText(oldText, "Original text")}{" "}
      <span className="text-slate-500 dark:text-slate-400">with</span>{" "}
      {renderQuotedSuggestionText(newText, "Changed text")}
    </>
  );
}

export function DocumentReviewRail({
  commentGroups,
  comments,
  suggestions,
  selectedCommentId,
  hoveredCommentId,
  selectedChangeId,
  hoveredChangeId,
  contentHeight,
  className,
  layout: railLayout = "anchored",
  testId,
  onDeleteComment,
  onUpdateComment,
  onReplyComment,
  onSelectComment,
  onFocusComment,
  onHoverComment,
  onAcceptSuggestion,
  onRejectSuggestion,
  onReplySuggestion,
  onSelectSuggestion,
  onFocusSuggestion,
  onHoverSuggestion,
  pendingFocusCommentId = null,
  newCommentDraftIds = [],
  onAutoFocusComment,
  draftSuggestion = null,
  onDraftSuggestionTextChange,
  onApplyDraftSuggestion,
  onCancelDraftSuggestion,
  editor = null,
}: DocumentReviewRailProps) {
  const draftTextareaRef = useRef<HTMLTextAreaElement>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const [itemHeights, setItemHeights] = useState<Record<string, number>>({});

  const activeRootThreadId = useMemo(
    () => getRootThreadIdForCommentId(selectedCommentId, comments),
    [comments, selectedCommentId],
  );

  const suggestionCommentIds = useMemo(
    () => new Set(suggestions.flatMap((suggestion) => suggestion.commentIds)),
    [suggestions],
  );

  const visibleCommentThreads = useMemo(
    () =>
      buildCommentThreadRailItems(
        commentGroups
          .map((group) => ({
            ...group,
            commentIds: group.commentIds.filter(
              (commentId) => !suggestionCommentIds.has(commentId),
            ),
          }))
          .filter((group) => group.commentIds.length > 0),
        comments,
      )
        .map((item) => {
          const visibleComments = item.commentIds
            .map((commentId) => comments.get(commentId))
            .filter((comment): comment is CriticComment => Boolean(comment));

          if (visibleComments.length === 0) return null;

          return {
            ...item,
            visibleComments,
          };
        })
        .filter(
          (
            item,
          ): item is CommentThreadRailItem & {
            visibleComments: CriticComment[];
          } => Boolean(item),
        ),
    [commentGroups, comments, suggestionCommentIds],
  );

  const commentEntries = useMemo(
    () =>
      visibleCommentThreads.map((thread) => ({
        type: "comment" as const,
        key: thread.key,
        anchorTop: thread.anchorTop,
        anchorBottom: thread.anchorBottom,
        thread,
      })),
    [visibleCommentThreads],
  );

  const suggestionEntries = useMemo(
    () =>
      suggestions.map((suggestion) => ({
        type: "suggestion" as const,
        key: suggestion.changeId,
        anchorTop: suggestion.anchorTop,
        anchorBottom: suggestion.anchorBottom,
        suggestion,
      })),
    [suggestions],
  );

  const draftAnchorTop = useMemo(() => {
    if (!draftSuggestion || !editor) return 0;
    try {
      const editorElement = editor.view.dom as HTMLElement;
      const editorRect = editorElement.getBoundingClientRect();
      const coords = editor.view.coordsAtPos(draftSuggestion.from);
      return coords.top - editorRect.top;
    } catch {
      return 0;
    }
  }, [draftSuggestion, editor]);

  const draftEntry = useMemo(() => {
    if (!draftSuggestion) return null;
    return {
      type: "draft" as const,
      key: "__draft_suggestion__",
      anchorTop: draftAnchorTop,
      anchorBottom: draftAnchorTop + 20,
    };
  }, [draftSuggestion, draftAnchorTop]);

  const activeSuggestionIdForComment = useMemo(
    () =>
      selectedCommentId
        ? (suggestions.find((suggestion) =>
            suggestion.commentIds.includes(selectedCommentId),
          )?.changeId ?? null)
        : null,
    [selectedCommentId, suggestions],
  );

  const layouts = useMemo(() => {
    const entries = [
      ...suggestionEntries,
      ...commentEntries,
      ...(draftEntry ? [draftEntry] : []),
    ].sort((left, right) => left.anchorTop - right.anchorTop);
    const activeKey =
      draftEntry?.key ??
      selectedChangeId ??
      activeSuggestionIdForComment ??
      activeRootThreadId;

    return resolveAnchoredRailLayouts(entries, itemHeights, activeKey);
  }, [
    activeRootThreadId,
    activeSuggestionIdForComment,
    commentEntries,
    draftEntry,
    itemHeights,
    selectedChangeId,
    suggestionEntries,
  ]);

  const setItemRef = useCallback((key: string, node: HTMLDivElement | null) => {
    if (node) {
      itemRefs.current.set(key, node);
    } else {
      itemRefs.current.delete(key);
    }
  }, []);

  useLayoutEffect(() => {
    if (layouts.length === 0) {
      setItemHeights((current) =>
        Object.keys(current).length === 0 ? current : {},
      );
      return;
    }

    const updateHeights = () => {
      setItemHeights((current) => {
        const next: Record<string, number> = {};
        let changed = false;

        for (const layout of layouts) {
          const element = itemRefs.current.get(layout.key);
          const measuredHeight = Math.ceil(
            element?.getBoundingClientRect().height ?? 0,
          );
          const height =
            measuredHeight > 0
              ? Math.ceil(normalizeCommentMeasurement(measuredHeight, 1))
              : (current[layout.key] ?? 0);
          next[layout.key] = height;
          if (current[layout.key] !== height) {
            changed = true;
          }
        }

        if (
          !changed &&
          Object.keys(current).length === Object.keys(next).length
        ) {
          return current;
        }

        return next;
      });
    };

    updateHeights();

    const resizeObserver = new ResizeObserver(() => {
      updateHeights();
    });

    for (const layout of layouts) {
      const element = itemRefs.current.get(layout.key);
      if (element) {
        resizeObserver.observe(element);
      }
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [layouts]);

  useEffect(() => {
    if (draftSuggestion && draftTextareaRef.current) {
      draftTextareaRef.current.focus();
    }
  }, [draftSuggestion]);

  const railHeight =
    railLayout === "flow"
      ? undefined
      : Math.max(contentHeight, layouts.at(-1)?.railBottom ?? 0) + 24;

  const hasDraftOnly = layouts.length === 0 && !draftSuggestion;
  if (hasDraftOnly) {
    return <aside className={cn("min-w-0", className)} aria-hidden="true" />;
  }

  return (
    <aside className={cn("min-w-0", className)} data-testid={testId}>
      <div
        className={cn(railLayout === "flow" ? "grid gap-3" : "relative")}
        style={railHeight ? { minHeight: railHeight } : undefined}
      >
        {layouts.map((layout) => {
          if (layout.type === "comment") {
            const isSelected =
              !!activeRootThreadId &&
              layout.thread.rootCommentId === activeRootThreadId;
            const isExpanded = isSelected;
            const primaryCommentId =
              getPreferredCommentId(
                layout.thread.commentIds,
                selectedCommentId,
              ) ?? layout.thread.visibleComments[0]?.id;

            return (
              <div
                key={layout.key}
                ref={(node) => setItemRef(layout.key, node)}
                data-testid={`comment-thread-${layout.thread.rootCommentId}`}
                data-comment-thread-container="true"
                className={cn(
                  railLayoutItemClass(railLayout),
                  isSelected
                    ? "border-[#DFDFDC] dark:border-slate-600 bg-white dark:bg-card shadow-[0_20px_48px_rgba(57,47,38,0.14)] dark:shadow-[0_20px_48px_rgba(0,0,0,0.4)]"
                    : "",
                  isSelected && "-translate-x-2",
                  isExpanded ? "cursor-default" : "cursor-pointer",
                )}
                style={railLayoutItemStyle(railLayout, layout.railTop)}
                onMouseEnter={() => {
                  if (primaryCommentId) {
                    onHoverComment(primaryCommentId);
                  }
                }}
                onMouseLeave={() => onHoverComment(null)}
                onClick={() => {
                  if (isExpanded || !primaryCommentId) return;
                  onFocusComment(primaryCommentId);
                }}
              >
                <CommentEditorList
                  comments={layout.thread.visibleComments}
                  variant="rail"
                  className={cn(!isExpanded && "pointer-events-none")}
                  interactive={isExpanded}
                  selectedCommentId={selectedCommentId}
                  hoveredCommentId={hoveredCommentId}
                  onDeleteComment={onDeleteComment}
                  onUpdateComment={onUpdateComment}
                  onReplyComment={onReplyComment}
                  onSelectComment={onSelectComment}
                  onFocusComment={onFocusComment}
                  onHoverComment={onHoverComment}
                  pendingFocusCommentId={pendingFocusCommentId}
                  newCommentDraftIds={newCommentDraftIds}
                  onAutoFocusComment={onAutoFocusComment}
                />
              </div>
            );
          }

          if (layout.type === "draft") {
            return (
              <div
                key={layout.key}
                ref={(node) => setItemRef(layout.key, node)}
                data-testid="draft-suggestion-thread"
                data-suggestion-thread-container="true"
                className={cn(
                  railLayoutItemClass(railLayout),
                  "-translate-x-2 border-[#DFDFDC] dark:border-slate-600 bg-white dark:bg-card px-4 py-3 shadow-[0_20px_48px_rgba(57,47,38,0.14)] dark:shadow-[0_20px_48px_rgba(0,0,0,0.4)]",
                )}
                style={railLayoutItemStyle(railLayout, layout.railTop)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold tracking-[0.08em] text-stone-500 dark:text-stone-400 uppercase">
                      {draftSuggestion?.type === "replacement"
                        ? "Replacement"
                        : "Insertion"}
                    </div>
                    <div className="mt-1 text-sm leading-5 text-slate-700 dark:text-slate-300">
                      {draftSuggestion?.sourceText || "Current cursor position"}
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid="draft-suggestion-action-dismiss"
                    className="flex size-7 shrink-0 items-center justify-center rounded-full text-stone-500 dark:text-stone-400 transition hover:bg-stone-100 dark:hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 dark:focus-visible:ring-slate-600"
                    aria-label="Cancel suggestion"
                    onClick={() => onCancelDraftSuggestion?.()}
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <textarea
                  ref={draftTextareaRef}
                  data-testid="draft-suggestion-editor"
                  value={draftSuggestion?.text ?? ""}
                  rows={2}
                  className="mt-3 min-h-16 w-full resize-y rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm leading-6 text-slate-800 dark:text-slate-200 outline-none transition focus:border-emerald-300 dark:focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 dark:focus:ring-emerald-900"
                  placeholder={
                    draftSuggestion?.type === "replacement"
                      ? "Replacement text"
                      : "Inserted text"
                  }
                  onChange={(event) => {
                    onDraftSuggestionTextChange?.(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (
                      (event.metaKey || event.ctrlKey) &&
                      event.key.toLowerCase() === "enter"
                    ) {
                      event.preventDefault();
                      onApplyDraftSuggestion?.();
                    }
                  }}
                />
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    data-testid="draft-suggestion-action-cancel"
                    className="inline-flex h-8 items-center gap-1 rounded-lg px-3 text-sm font-medium text-stone-600 dark:text-stone-400 transition hover:bg-stone-100 dark:hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 dark:focus-visible:ring-slate-600"
                    onClick={() => onCancelDraftSuggestion?.()}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    data-testid="draft-suggestion-action-apply"
                    className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 dark:bg-emerald-700 px-3 text-sm font-medium text-white transition hover:bg-emerald-700 dark:hover:bg-emerald-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 dark:focus-visible:ring-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!draftSuggestion?.text}
                    onClick={() => onApplyDraftSuggestion?.()}
                  >
                    <Check className="size-4" />
                    Suggest
                  </button>
                </div>
              </div>
            );
          }

          const suggestion = layout.suggestion;
          const isSelected = selectedChangeId === suggestion.changeId;
          const isHovered = hoveredChangeId === suggestion.changeId;
          const suggestionComments = suggestion.commentIds
            .map((commentId) => comments.get(commentId))
            .filter((comment): comment is CriticComment => Boolean(comment));
          const suggestionCommentIds = new Set(
            suggestionComments.map((comment) => comment.id),
          );
          const normalizedSuggestionComments = suggestionComments.map(
            (comment) =>
              comment.parentCommentId === suggestion.changeId ||
              (comment.parentCommentId &&
                suggestionCommentIds.has(comment.parentCommentId))
                ? comment
                : {
                    ...comment,
                    parentCommentId: suggestion.changeId,
                  },
          );
          const suggestionRootComment = getSuggestionRootComment(suggestion);
          const suggestionThreadComments = [
            suggestionRootComment,
            ...normalizedSuggestionComments,
          ];
          const renderCommentContent = ({
            comment,
            defaultContent,
          }: CommentContentRenderContext) =>
            comment.id === suggestion.changeId ? (
              <SuggestionCommentContent suggestion={suggestion} />
            ) : (
              defaultContent
            );
          const getCommentActions = ({
            comment,
            defaultActions,
          }: CommentActionsRenderContext): CommentActionDefinition[] =>
            comment.id === suggestion.changeId
              ? [
                  {
                    key: "accept",
                    label: "Accept suggestion",
                    icon: <Check className="size-3.5" />,
                    compact: true,
                    onClick: (event) => {
                      event.stopPropagation();
                      onAcceptSuggestion(suggestion.changeId);
                    },
                  },
                  {
                    key: "reject",
                    label: "Reject suggestion",
                    tone: "danger",
                    icon: <X className="size-3.5" />,
                    compact: true,
                    onClick: (event) => {
                      event.stopPropagation();
                      onRejectSuggestion(suggestion.changeId);
                    },
                  },
                  {
                    key: "reply",
                    label: "Reply",
                    icon: <Reply className="size-3.5" />,
                    compact: true,
                    onClick: (event) => {
                      event.stopPropagation();
                      onReplySuggestion(suggestion.changeId);
                    },
                  },
                ]
              : defaultActions;

          return (
            <div
              key={layout.key}
              ref={(node) => setItemRef(layout.key, node)}
              data-testid={`suggestion-thread-${suggestion.changeId}`}
              data-suggestion-thread-container="true"
              className={cn(
                railLayoutItemClass(railLayout),
                isSelected
                  ? "-translate-x-2 border-[#DFDFDC] dark:border-slate-600 bg-white dark:bg-card shadow-[0_20px_48px_rgba(57,47,38,0.14)] dark:shadow-[0_20px_48px_rgba(0,0,0,0.4)]"
                  : "",
                isHovered && !isSelected && "cursor-pointer",
              )}
              style={railLayoutItemStyle(railLayout, layout.railTop)}
              onMouseEnter={() => onHoverSuggestion(suggestion.changeId)}
              onMouseLeave={() => onHoverSuggestion(null)}
              onPointerDown={() => onSelectSuggestion(suggestion.changeId)}
              onClick={() => {
                if (isSelected) return;
                onFocusSuggestion(suggestion.changeId);
              }}
            >
              <CommentEditorList
                comments={suggestionThreadComments}
                variant="rail"
                selectedCommentId={
                  selectedCommentId ?? (isSelected ? suggestion.changeId : null)
                }
                hoveredCommentId={
                  hoveredCommentId ?? (isHovered ? suggestion.changeId : null)
                }
                onDeleteComment={onDeleteComment}
                onUpdateComment={onUpdateComment}
                onReplyComment={(commentId) => {
                  if (commentId === suggestion.changeId) {
                    onReplySuggestion(suggestion.changeId);
                    return;
                  }

                  onReplyComment(commentId);
                }}
                onSelectComment={(commentId) => {
                  if (commentId === suggestion.changeId) {
                    onSelectSuggestion(suggestion.changeId);
                    return;
                  }

                  onSelectComment(commentId);
                }}
                onFocusComment={(commentId) => {
                  if (commentId === suggestion.changeId) {
                    onFocusSuggestion(suggestion.changeId);
                    return;
                  }

                  onFocusComment(commentId);
                }}
                onHoverComment={(commentId) => {
                  if (commentId === suggestion.changeId) {
                    onHoverSuggestion(suggestion.changeId);
                    return;
                  }

                  onHoverComment(commentId);
                }}
                pendingFocusCommentId={pendingFocusCommentId}
                newCommentDraftIds={newCommentDraftIds}
                onAutoFocusComment={onAutoFocusComment}
                renderCommentContent={renderCommentContent}
                getCommentActions={getCommentActions}
              />
            </div>
          );
        })}
      </div>
    </aside>
  );
}
