import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CommentEditorList } from "./CommentEditorList";
import type { CriticComment, CriticReaction } from "./critic-markup";
import {
  buildCommentThreadRailItems,
  type CommentGroupAnchor,
  type CommentThreadRailItem,
  getPreferredCommentId,
  getRootThreadIdForCommentId,
  normalizeCommentMeasurement,
  resolveCommentThreadRailLayouts,
} from "./document-comments";
import { cn } from "./lib/utils";

interface DocumentCommentRailProps {
  commentGroups: CommentGroupAnchor[];
  comments: Map<string, CriticComment>;
  selectedCommentId: string | null;
  hoveredCommentId: string | null;
  contentHeight: number;
  className?: string;
  onDeleteComment: (commentId: string) => void;
  onUpdateComment: (commentId: string, nextContent: string) => void;
  onReplyComment: (commentId: string) => void;
  onReactComment: (commentId: string, reaction: CriticReaction | null) => void;
  onSelectComment: (commentId: string) => void;
  onFocusComment: (commentId: string) => void;
  onHoverComment: (commentId: string | null) => void;
  pendingFocusCommentId?: string | null;
  onAutoFocusComment?: (commentId: string) => void;
}

export function DocumentCommentRail({
  commentGroups,
  comments,
  selectedCommentId,
  hoveredCommentId,
  contentHeight,
  className,
  onDeleteComment,
  onUpdateComment,
  onReplyComment,
  onReactComment,
  onSelectComment,
  onFocusComment,
  onHoverComment,
  pendingFocusCommentId = null,
  onAutoFocusComment,
}: DocumentCommentRailProps) {
  const threadRefs = useRef(new Map<string, HTMLDivElement>());
  const [threadHeights, setThreadHeights] = useState<Record<string, number>>(
    {},
  );

  const activeRootThreadId = useMemo(
    () => getRootThreadIdForCommentId(selectedCommentId, comments),
    [comments, selectedCommentId],
  );

  const visibleThreads = useMemo(
    () =>
      buildCommentThreadRailItems(commentGroups, comments)
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
    [commentGroups, comments],
  );

  const setThreadRef = useCallback(
    (key: string, node: HTMLDivElement | null) => {
      if (node) {
        threadRefs.current.set(key, node);
      } else {
        threadRefs.current.delete(key);
      }
    },
    [],
  );

  useLayoutEffect(() => {
    if (visibleThreads.length === 0) {
      setThreadHeights({});
      return;
    }

    const updateHeights = () => {
      setThreadHeights((current) => {
        const next: Record<string, number> = {};
        let changed = false;

        for (const thread of visibleThreads) {
          const element = threadRefs.current.get(thread.key);
          const measuredHeight = Math.ceil(
            element?.getBoundingClientRect().height ?? 0,
          );
          const height =
            measuredHeight > 0
              ? Math.ceil(normalizeCommentMeasurement(measuredHeight, 1))
              : (current[thread.key] ?? 0);
          next[thread.key] = height;
          if (current[thread.key] !== height) {
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

    for (const thread of visibleThreads) {
      const element = threadRefs.current.get(thread.key);
      if (element) {
        resizeObserver.observe(element);
      }
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [visibleThreads]);

  const layouts = useMemo(() => {
    const baseLayouts = resolveCommentThreadRailLayouts(
      visibleThreads,
      threadHeights,
      activeRootThreadId,
    );

    return baseLayouts.map((layout) => ({
      ...layout,
      visibleComments:
        visibleThreads.find((thread) => thread.key === layout.key)
          ?.visibleComments ?? [],
    }));
  }, [activeRootThreadId, threadHeights, visibleThreads]);

  const railHeight =
    Math.max(contentHeight, layouts.at(-1)?.railBottom ?? 0) + 24;

  if (visibleThreads.length === 0) {
    return <aside className={cn("min-w-0", className)} aria-hidden="true" />;
  }

  return (
    <aside className={cn("min-w-0", className)}>
      <div className="relative" style={{ minHeight: railHeight }}>
        {layouts.map((layout) => {
          const isSelected =
            !!activeRootThreadId && layout.rootCommentId === activeRootThreadId;
          const isExpanded = isSelected;
          const primaryCommentId =
            getPreferredCommentId(layout.commentIds, selectedCommentId) ??
            layout.visibleComments[0]?.id;

          return (
            <div
              key={layout.key}
              ref={(node) => setThreadRef(layout.key, node)}
              data-comment-thread-container="true"
              className={cn(
                "absolute left-0 right-0 rounded-xl border border-transparent bg-transparent shadow-none transition-all duration-200 ease-out will-change-transform",
                isSelected
                  ? "border-[#DFDFDC] dark:border-slate-600 bg-white dark:bg-slate-800 shadow-[0_20px_48px_rgba(57,47,38,0.14)] dark:shadow-[0_20px_48px_rgba(0,0,0,0.4)]"
                  : "",
                isSelected && "-translate-x-2",
                isExpanded ? "cursor-default" : "cursor-pointer",
              )}
              style={{ top: layout.railTop }}
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
                comments={layout.visibleComments}
                variant="rail"
                className={cn(!isExpanded && "pointer-events-none")}
                interactive={isExpanded}
                selectedCommentId={selectedCommentId}
                hoveredCommentId={hoveredCommentId}
                onDeleteComment={onDeleteComment}
                onUpdateComment={onUpdateComment}
                onReplyComment={onReplyComment}
                onReactComment={onReactComment}
                onSelectComment={onSelectComment}
                onFocusComment={onFocusComment}
                onHoverComment={onHoverComment}
                pendingFocusCommentId={pendingFocusCommentId}
                onAutoFocusComment={onAutoFocusComment}
              />
            </div>
          );
        })}
      </div>
    </aside>
  );
}
