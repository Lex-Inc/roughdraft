import {
  Bot,
  Check,
  MessageCircleQuestion,
  Pencil,
  Reply,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  User,
  X,
} from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/ui/tooltip";
import {
  buildCommentThreads,
  type CriticComment,
  type CriticCommentThread,
  type CriticReaction,
} from "./critic-markup";
import { cn } from "./lib/utils";

interface CommentEditorListProps {
  comments: CriticComment[];
  variant?: "banner" | "rail";
  selectedCommentId?: string | null;
  hoveredCommentId?: string | null;
  className?: string;
  testId?: string;
  interactive?: boolean;
  onDeleteComment: (commentId: string) => void;
  onUpdateComment: (commentId: string, nextContent: string) => void;
  onSelectComment?: (commentId: string) => void;
  onHoverComment?: (commentId: string | null) => void;
  onFocusComment?: (commentId: string) => void;
  onReplyComment?: (commentId: string) => void;
  onReactComment?: (commentId: string, reaction: CriticReaction | null) => void;
  pendingFocusCommentId?: string | null;
  newCommentDraftIds?: string[];
  onAutoFocusComment?: (commentId: string) => void;
  renderCommentContent?: (context: CommentContentRenderContext) => ReactNode;
  getCommentActions?: (
    context: CommentActionsRenderContext,
  ) => CommentActionDefinition[];
}

export interface CommentActionDefinition {
  key: string;
  label: string;
  tone?: "neutral" | "danger";
  presentation?: "default" | "popover";
  icon: ReactNode;
  compact?: boolean;
  onClick: (event: MouseEvent) => void;
}

export interface CommentContentRenderContext {
  comment: CriticComment;
  depth: number;
  isEditing: boolean;
  defaultContent: ReactNode;
}

export interface CommentActionsRenderContext {
  comment: CriticComment;
  depth: number;
  isEditing: boolean;
  defaultActions: CommentActionDefinition[];
}

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="textbox"]',
    ),
  );
}

function isReplyShortcut(event: KeyboardEvent) {
  return (
    event.key.toLowerCase() === "r" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  );
}

export function CommentEditorList({
  comments,
  variant = "banner",
  selectedCommentId = null,
  hoveredCommentId = null,
  className,
  testId,
  interactive = true,
  onDeleteComment,
  onUpdateComment,
  onSelectComment,
  onHoverComment,
  onFocusComment,
  onReplyComment,
  onReactComment,
  pendingFocusCommentId = null,
  newCommentDraftIds = [],
  onAutoFocusComment,
  renderCommentContent,
  getCommentActions,
}: CommentEditorListProps) {
  const textareaRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editingCommentIds, setEditingCommentIds] = useState<string[]>([]);
  const threads = useMemo(() => buildCommentThreads(comments), [comments]);
  const commentMap = useMemo(
    () => new Map(comments.map((comment) => [comment.id, comment])),
    [comments],
  );
  const hasActiveSelection =
    !!selectedCommentId &&
    comments.some((comment) => comment.id === selectedCommentId);
  const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive || !onReplyComment) return;
    if (!isReplyShortcut(event)) return;
    if (isEditableShortcutTarget(event.target)) return;

    const target = event.target;
    if (!(target instanceof Element)) return;

    const rootThread = target.closest<HTMLElement>(
      "[data-comment-thread-root-id]",
    );
    const rootCommentId = rootThread?.dataset.commentThreadRootId;
    if (!rootCommentId) return;

    event.preventDefault();
    event.stopPropagation();
    onReplyComment(rootCommentId);
  };

  useEffect(() => {
    const validCommentIds = new Set(comments.map((comment) => comment.id));

    setDrafts((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([commentId]) =>
          validCommentIds.has(commentId),
        ),
      ),
    );
    setEditingCommentIds((current) =>
      current.filter((commentId) => validCommentIds.has(commentId)),
    );
  }, [comments]);

  useEffect(() => {
    if (!interactive) return;
    if (!pendingFocusCommentId) return;

    const pendingComment = commentMap.get(pendingFocusCommentId);
    if (!pendingComment) return;

    setDrafts((current) => ({
      ...current,
      [pendingFocusCommentId]:
        current[pendingFocusCommentId] ?? pendingComment.content,
    }));
    setEditingCommentIds((current) =>
      current.includes(pendingFocusCommentId)
        ? current
        : [...current, pendingFocusCommentId],
    );
  }, [commentMap, interactive, pendingFocusCommentId]);

  useEffect(() => {
    if (!interactive) return;
    if (!pendingFocusCommentId) return;
    if (!editingCommentIds.includes(pendingFocusCommentId)) return;

    const target = textareaRefs.current.get(pendingFocusCommentId);
    if (!target || target.offsetParent === null) return;

    target.focus();
    const cursorPosition = target.value.length;
    target.setSelectionRange(cursorPosition, cursorPosition);
    onAutoFocusComment?.(pendingFocusCommentId);
  }, [
    editingCommentIds,
    interactive,
    onAutoFocusComment,
    pendingFocusCommentId,
  ]);

  if (comments.length === 0) return null;

  const startEditingComment = (commentId: string) => {
    const comment = commentMap.get(commentId);
    if (!comment) return;

    setDrafts((current) => ({
      ...current,
      [commentId]: current[commentId] ?? comment.content,
    }));
    setEditingCommentIds((current) =>
      current.includes(commentId) ? current : [...current, commentId],
    );
    onSelectComment?.(commentId);
  };

  const stopEditingComment = (commentId: string) => {
    setEditingCommentIds((current) =>
      current.filter((currentCommentId) => currentCommentId !== commentId),
    );
  };

  const submitEditingComment = (commentId: string) => {
    const comment = commentMap.get(commentId);
    if (!comment) return;

    const nextContent = (drafts[commentId] ?? comment.content).trim();

    if (nextContent.length === 0) {
      onDeleteComment(commentId);
      return;
    }

    if (nextContent !== comment.content) {
      onUpdateComment(commentId, nextContent);
    }

    setDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[commentId];
      return nextDrafts;
    });
    stopEditingComment(commentId);
  };

  const cancelEditingComment = (commentId: string) => {
    const comment = commentMap.get(commentId);
    if (!comment) return;

    setDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[commentId];
      return nextDrafts;
    });

    if (comment.content.trim().length === 0) {
      onDeleteComment(commentId);
      return;
    }

    stopEditingComment(commentId);
  };

  return (
    <div
      data-testid={testId}
      data-comment-thread-container="true"
      className={cn(
        variant === "banner"
          ? cn(
              "space-y-2 rounded-xl border border-transparent bg-transparent p-3 shadow-none transition-[background-color,border-color,box-shadow] duration-200 ease-out",
              hasActiveSelection
                ? "border-[#DFDFDC] dark:border-slate-600 bg-white dark:bg-card shadow-[0_20px_48px_rgba(57,47,38,0.14)] dark:shadow-[0_20px_48px_rgba(0,0,0,0.4)]"
                : "",
            )
          : "space-y-1.5 px-4 py-3",
        className,
      )}
      onKeyDownCapture={handleKeyDownCapture}
    >
      {threads.map((thread, index) => (
        <CommentThreadNode
          key={thread.comment.id}
          thread={thread}
          depth={0}
          index={index}
          isLast={index === threads.length - 1}
          parentLines={[]}
          variant={variant}
          interactive={interactive}
          drafts={drafts}
          newCommentDraftIds={newCommentDraftIds}
          editingCommentIds={editingCommentIds}
          pendingFocusCommentId={pendingFocusCommentId}
          selectedCommentId={selectedCommentId}
          hoveredCommentId={hoveredCommentId}
          textareaRefs={textareaRefs}
          onDeleteComment={onDeleteComment}
          onUpdateComment={onUpdateComment}
          onSelectComment={onSelectComment}
          onHoverComment={onHoverComment}
          onFocusComment={onFocusComment}
          onReplyComment={onReplyComment}
          onReactComment={onReactComment}
          onStartEditingComment={startEditingComment}
          onSubmitEditingComment={submitEditingComment}
          onCancelEditingComment={cancelEditingComment}
          renderCommentContent={renderCommentContent}
          getCommentActions={getCommentActions}
          onChangeDraft={(commentId, nextContent) => {
            setDrafts((current) => ({
              ...current,
              [commentId]: nextContent,
            }));
          }}
        />
      ))}
    </div>
  );
}

interface CommentThreadNodeProps {
  thread: CriticCommentThread;
  depth: number;
  index: number;
  isLast: boolean;
  parentLines: boolean[];
  variant: "banner" | "rail";
  interactive: boolean;
  drafts: Record<string, string>;
  newCommentDraftIds: string[];
  editingCommentIds: string[];
  pendingFocusCommentId: string | null;
  selectedCommentId: string | null;
  hoveredCommentId: string | null;
  textareaRefs: MutableRefObject<Map<string, HTMLTextAreaElement>>;
  onDeleteComment: (commentId: string) => void;
  onUpdateComment: (commentId: string, nextContent: string) => void;
  onSelectComment?: (commentId: string) => void;
  onHoverComment?: (commentId: string | null) => void;
  onFocusComment?: (commentId: string) => void;
  onReplyComment?: (commentId: string) => void;
  onReactComment?: (commentId: string, reaction: CriticReaction | null) => void;
  onStartEditingComment: (commentId: string) => void;
  onSubmitEditingComment: (commentId: string) => void;
  onCancelEditingComment: (commentId: string) => void;
  renderCommentContent?: (context: CommentContentRenderContext) => ReactNode;
  getCommentActions?: (
    context: CommentActionsRenderContext,
  ) => CommentActionDefinition[];
  onChangeDraft: (commentId: string, nextContent: string) => void;
}

const COMMENT_TREE_INDENT = 16;
const COMMENT_TREE_ELBOW_TOP = 12;
const COMMENT_TREE_ROW_GAP = 10;
const COMMENT_AVATAR_SIZE = 20;
const COMMENT_AVATAR_CENTER = 12;

function CommentActionButton({
  label,
  testId,
  tone = "neutral",
  presentation = "default",
  icon,
  compact = false,
  className,
  onClick,
}: {
  label: string;
  testId?: string;
  tone?: "neutral" | "danger";
  presentation?: "default" | "popover";
  icon: ReactNode;
  compact?: boolean;
  className?: string;
  onClick: (event: MouseEvent) => void;
}) {
  const button = (
    <Button
      type="button"
      aria-label={compact ? label : undefined}
      data-testid={testId}
      variant="ghost"
      size={compact ? "icon-xs" : "sm"}
      className={cn(
        presentation === "popover" && !compact
          ? "h-9 w-full rounded-xl bg-[#E8E3DB] px-3 py-2 text-sm font-bold normal-case tracking-normal text-black shadow-[inset_0_1px_0_rgba(255,251,245,0.72)] hover:bg-[#ded8ce] hover:text-black dark:bg-slate-700 dark:text-slate-100 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] dark:hover:bg-slate-600 dark:hover:text-slate-100"
          : compact
            ? "rounded-full border border-transparent transition-colors duration-150"
            : "h-7 rounded-full border border-transparent px-2.5 text-[11px] font-medium tracking-[0.08em] uppercase transition-colors duration-150",
        presentation === "popover"
          ? ""
          : tone === "danger"
            ? "text-stone-400 hover:bg-rose-100 hover:text-rose-700 dark:text-stone-500 dark:hover:bg-rose-900/40 dark:hover:text-rose-400"
            : "text-stone-400 hover:bg-[#DED8CE]/45 hover:text-stone-600 dark:text-stone-500 dark:hover:bg-slate-700 dark:hover:text-stone-300",
        className,
      )}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
    >
      {icon}
      {compact ? null : <span>{label}</span>}
    </Button>
  );

  if (!compact) return button;

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function CommentThreadNode({
  thread,
  depth,
  index,
  isLast,
  parentLines,
  variant,
  interactive,
  drafts,
  newCommentDraftIds,
  editingCommentIds,
  pendingFocusCommentId,
  selectedCommentId,
  hoveredCommentId,
  textareaRefs,
  onDeleteComment,
  onUpdateComment,
  onSelectComment,
  onHoverComment,
  onFocusComment,
  onReplyComment,
  onReactComment,
  onStartEditingComment,
  onSubmitEditingComment,
  onCancelEditingComment,
  renderCommentContent,
  getCommentActions,
  onChangeDraft,
}: CommentThreadNodeProps) {
  const { comment, replies } = thread;
  const hasReplies = replies.length > 0;
  const isRootThread = depth === 0;
  const isSelected = comment.id === selectedCommentId;
  const isHovered = comment.id === hoveredCommentId;
  const isEditing = interactive && editingCommentIds.includes(comment.id);
  const isAiAuthor = comment.authorType === "ai";
  const userAuthorId = comment.authorId?.trim();
  const authorLabel = isAiAuthor
    ? "AI"
    : userAuthorId && userAuthorId.toLowerCase() !== "user"
      ? userAuthorId
      : "Me";
  const AuthorIcon = isAiAuthor ? Bot : User;
  const draftContent = drafts[comment.id] ?? comment.content;
  const avatarTone = isAiAuthor
    ? variant === "banner"
      ? "border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-700 dark:bg-sky-900 dark:text-sky-400"
      : "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-900 dark:text-sky-400"
    : variant === "banner"
      ? "border-[#D2C7B8] bg-[#DED8CE] text-stone-700 dark:border-slate-600 dark:bg-slate-700 dark:text-stone-300"
      : "border-[#D2C7B8] bg-[#DED8CE] text-stone-700 dark:border-slate-600 dark:bg-slate-700 dark:text-stone-300";
  const bodyTone =
    variant === "banner"
      ? isSelected
        ? "bg-white"
        : isHovered
          ? "bg-white"
          : "bg-transparent"
      : "bg-transparent";
  const treeLineTone =
    variant === "banner"
      ? "bg-[#DED8CE]/90 dark:bg-slate-600/90"
      : "bg-[#DED8CE]/85 dark:bg-slate-600/85";
  const hasCommentContent = comment.content.trim().length > 0;
  const defaultContent = hasCommentContent ? comment.content : "Empty comment";
  const isNewRootCommentDraft =
    isEditing &&
    depth === 0 &&
    (comment.id === pendingFocusCommentId ||
      newCommentDraftIds.includes(comment.id));
  const renderedContent =
    renderCommentContent?.({
      comment,
      depth,
      isEditing,
      defaultContent,
    }) ?? defaultContent;
  const defaultActions: CommentActionDefinition[] = isEditing
    ? [
        {
          key: "save",
          label: "Save",
          presentation: isNewRootCommentDraft ? "popover" : "default",
          icon: <Check className="size-3.5" />,
          onClick: (event) => {
            event.stopPropagation();
            onSubmitEditingComment(comment.id);
          },
        },
        {
          key: "cancel",
          label: "Cancel",
          icon: <X className="size-3.5" />,
          onClick: (event) => {
            event.stopPropagation();
            onCancelEditingComment(comment.id);
          },
        },
      ]
    : [
        {
          key: "reply",
          label: "Reply",
          icon: <Reply className="size-3.5" />,
          compact: true,
          onClick: (event) => {
            event.stopPropagation();
            onReplyComment?.(comment.id);
          },
        },
        {
          key: "edit",
          label: "Edit",
          icon: <Pencil className="size-3.5" />,
          compact: true,
          onClick: (event) => {
            event.stopPropagation();
            onStartEditingComment(comment.id);
          },
        },
        {
          key: "delete",
          label: "Delete",
          tone: "danger",
          icon: <Trash2 className="size-3.5" />,
          compact: true,
          onClick: (event) => {
            event.stopPropagation();
            onDeleteComment(comment.id);
          },
        },
      ];
  const defaultVisibleActions = isNewRootCommentDraft
    ? defaultActions.filter((action) => action.key !== "cancel")
    : defaultActions;
  const actions =
    getCommentActions?.({
      comment,
      depth,
      isEditing,
      defaultActions: defaultVisibleActions,
    }) ?? defaultVisibleActions;
  const ancestorGuideOffsets = parentLines.reduce<number[]>(
    (offsets, showLine, guideIndex) => {
      if (showLine) {
        offsets.push(guideIndex * COMMENT_TREE_INDENT + COMMENT_AVATAR_CENTER);
      }
      return offsets;
    },
    [],
  );

  return (
    <div
      data-testid={`comment-${variant}-${comment.id}`}
      data-comment-thread-root-id={isRootThread ? comment.id : undefined}
      tabIndex={interactive && isRootThread ? 0 : undefined}
      className={cn(
        "relative transition-all duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 dark:focus-visible:ring-slate-600",
        variant === "rail" &&
          isRootThread &&
          (index > 0
            ? "border-t border-slate-200/80 dark:border-slate-700/80 pt-3"
            : "pt-0"),
      )}
      onClick={() => {
        if (!interactive) return;
        onSelectComment?.(comment.id);
      }}
      onMouseEnter={() => {
        if (!interactive) return;
        onHoverComment?.(comment.id);
      }}
      onMouseLeave={() => {
        if (!interactive) return;
        onHoverComment?.(null);
      }}
      onPointerDown={() => {
        if (!interactive) return;
        onSelectComment?.(comment.id);
      }}
    >
      <div className="relative flex min-w-0 items-stretch">
        {depth > 0 ? (
          <div
            aria-hidden="true"
            className="pointer-events-none relative shrink-0 self-stretch"
            style={{ width: depth * COMMENT_TREE_INDENT }}
          >
            {ancestorGuideOffsets.map((left) => (
              <div
                key={`${comment.id}-guide-${left}`}
                data-testid="comment-tree-line"
                className={cn("absolute top-0 bottom-0 w-px", treeLineTone)}
                style={{
                  left,
                  top: -COMMENT_TREE_ROW_GAP,
                  bottom: -COMMENT_TREE_ROW_GAP,
                }}
              />
            ))}
            <div
              data-testid="comment-tree-line"
              className={cn(
                "absolute w-px",
                treeLineTone,
                isLast ? "" : "bottom-0",
              )}
              style={{
                left: (depth - 1) * COMMENT_TREE_INDENT + COMMENT_AVATAR_CENTER,
                top: -COMMENT_TREE_ROW_GAP,
                ...(isLast
                  ? {
                      height: COMMENT_TREE_ELBOW_TOP + COMMENT_TREE_ROW_GAP,
                    }
                  : {
                      bottom: -COMMENT_TREE_ROW_GAP,
                    }),
              }}
            />
            <div
              data-testid="comment-tree-line"
              className={cn("absolute h-px", treeLineTone)}
              style={{
                left: (depth - 1) * COMMENT_TREE_INDENT + COMMENT_AVATAR_CENTER,
                top: COMMENT_TREE_ELBOW_TOP,
                width: COMMENT_TREE_INDENT,
              }}
            />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-1.5">
            {interactive && isRootThread ? (
              <CommentActionButton
                label="Delete thread"
                testId={`comment-${variant}-${comment.id}-action-delete-thread`}
                tone="danger"
                icon={<Trash2 className="size-3.5" />}
                compact
                className="absolute top-0 right-0 z-20 bg-white/80 dark:bg-slate-800/80"
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteComment(comment.id);
                }}
              />
            ) : null}
            {hasReplies ? (
              <div
                aria-hidden="true"
                data-testid="comment-tree-line"
                className={cn(
                  "pointer-events-none absolute w-px",
                  treeLineTone,
                )}
                style={{
                  left: COMMENT_AVATAR_CENTER,
                  top: COMMENT_AVATAR_SIZE,
                  bottom: -COMMENT_TREE_ROW_GAP,
                }}
              />
            ) : null}
            <div className="relative flex justify-center">
              <div
                className={cn(
                  "relative z-10 flex size-5 items-center justify-center rounded-full border shadow-[0_1px_2px_rgba(15,23,42,0.08)]",
                  avatarTone,
                )}
                title={authorLabel}
              >
                <AuthorIcon className="size-2.5 shrink-0" />
              </div>
            </div>
            <div
              className={cn(
                "min-w-0 rounded-xl px-0.5",
                isRootThread && interactive && !isEditing && "pr-7",
                bodyTone,
              )}
            >
              <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                {authorLabel}
              </div>
              <div
                className={cn(
                  "mt-0.5 text-[13px] leading-5 whitespace-pre-wrap",
                  !hasCommentContent && "italic",
                  variant === "banner"
                    ? "text-slate-800 dark:text-slate-200"
                    : "text-slate-700 dark:text-slate-300",
                )}
              >
                {isEditing ? null : renderedContent}
              </div>
              {isEditing ? (
                <Textarea
                  data-testid={`comment-${variant}-${comment.id}-editor`}
                  ref={(node) => {
                    if (node) {
                      textareaRefs.current.set(comment.id, node);
                    } else {
                      textareaRefs.current.delete(comment.id);
                    }
                  }}
                  value={draftContent}
                  placeholder={
                    depth === 0 ? "Add your comment" : "Write a reply"
                  }
                  rows={1}
                  className={cn(
                    "mt-2 min-h-12 px-2.5 py-2 text-[13px] leading-5 md:text-[13px] md:leading-5",
                    variant === "banner"
                      ? "border-amber-200 dark:border-amber-700 bg-white/90 dark:bg-slate-800/90 text-slate-800 dark:text-slate-200"
                      : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 shadow-none",
                  )}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    onSelectComment?.(comment.id);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                  onKeyDown={(event) => {
                    if (
                      (event.metaKey || event.ctrlKey) &&
                      event.key.toLowerCase() === "enter"
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                      onSubmitEditingComment(comment.id);
                      return;
                    }

                    if (event.key !== "Escape") return;

                    event.preventDefault();
                    event.stopPropagation();
                    onCancelEditingComment(comment.id);
                  }}
                  onFocus={() => {
                    onSelectComment?.(comment.id);
                  }}
                  onChange={(event) => {
                    onChangeDraft(comment.id, event.target.value);
                  }}
                />
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {actions.map((action) => (
                  <CommentActionButton
                    key={action.key}
                    label={action.label}
                    testId={`comment-${variant}-${comment.id}-action-${action.key}`}
                    tone={action.tone}
                    presentation={action.presentation}
                    icon={action.icon}
                    compact={action.compact}
                    onClick={action.onClick}
                  />
                ))}
                {!isEditing && onReactComment ? (
                  <>
                    <CommentActionButton
                      label="Thumbs up"
                      testId={`comment-${variant}-${comment.id}-reaction-up`}
                      icon={<ThumbsUp className="size-3.5" />}
                      compact
                      className={
                        comment.reaction === "up"
                          ? "border-stone-300 bg-[#DED8CE]/45 text-stone-600 dark:border-slate-500 dark:bg-slate-700 dark:text-stone-300"
                          : ""
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        onReactComment(
                          comment.id,
                          comment.reaction === "up" ? null : "up",
                        );
                      }}
                    />
                    <CommentActionButton
                      label="Thumbs down"
                      testId={`comment-${variant}-${comment.id}-reaction-down`}
                      icon={<ThumbsDown className="size-3.5" />}
                      compact
                      className={
                        comment.reaction === "down"
                          ? "border-stone-300 bg-[#DED8CE]/45 text-stone-600 dark:border-slate-500 dark:bg-slate-700 dark:text-stone-300"
                          : ""
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        onReactComment(
                          comment.id,
                          comment.reaction === "down" ? null : "down",
                        );
                      }}
                    />
                    <CommentActionButton
                      label="Needs clarification"
                      testId={`comment-${variant}-${comment.id}-reaction-clarify`}
                      icon={<MessageCircleQuestion className="size-3.5" />}
                      compact
                      className={
                        comment.reaction === "clarify"
                          ? "border-stone-300 bg-[#DED8CE]/45 text-stone-600 dark:border-slate-500 dark:bg-slate-700 dark:text-stone-300"
                          : ""
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        onReactComment(
                          comment.id,
                          comment.reaction === "clarify" ? null : "clarify",
                        );
                      }}
                    />
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
      {hasReplies ? (
        <div className="mt-2.5 space-y-2.5">
          {replies.map((reply, replyIndex) => (
            <CommentThreadNode
              key={reply.comment.id}
              thread={reply}
              depth={depth + 1}
              index={replyIndex}
              isLast={replyIndex === replies.length - 1}
              parentLines={depth === 0 ? [] : [...parentLines, !isLast]}
              variant={variant}
              interactive={interactive}
              drafts={drafts}
              newCommentDraftIds={newCommentDraftIds}
              editingCommentIds={editingCommentIds}
              pendingFocusCommentId={pendingFocusCommentId}
              selectedCommentId={selectedCommentId}
              hoveredCommentId={hoveredCommentId}
              textareaRefs={textareaRefs}
              onDeleteComment={onDeleteComment}
              onUpdateComment={onUpdateComment}
              onSelectComment={onSelectComment}
              onHoverComment={onHoverComment}
              onFocusComment={onFocusComment}
              onReplyComment={onReplyComment}
              onReactComment={onReactComment}
              onStartEditingComment={onStartEditingComment}
              onSubmitEditingComment={onSubmitEditingComment}
              onCancelEditingComment={onCancelEditingComment}
              renderCommentContent={renderCommentContent}
              getCommentActions={getCommentActions}
              onChangeDraft={onChangeDraft}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
