import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bold,
  Code2,
  Check,
  ExternalLink,
  Italic,
  Link2,
  List,
  ListOrdered,
  MessageSquarePlus,
  Quote,
  Trash2,
  X,
} from "lucide-react";
import {
  getAddCommentShortcutLabel,
  matchesAddCommentShortcut,
} from "./comment-shortcuts";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/ui/tooltip";
import { toHtml } from "./markdown";
import type { StorageBackend } from "./storage";

interface EditorContextMenuProps {
  editor: Editor | null;
  backend: StorageBackend;
  resolveLinkUrl?: (path: string) => string | null;
  onAddComment?: () => void;
  onSuggestDeletion?: () => void;
  onSuggestReplacement?: () => void;
  onSuggestInsertion?: () => void;
  children: ReactNode;
}

interface MenuPosition {
  x: number;
  y: number;
}

interface SelectionActionPosition {
  left: number;
  top: number;
}

interface LinkPopoverState {
  href: string;
  rawHref: string;
  left: number;
  top: number;
  existingLink: boolean;
  focusInput: boolean;
}

function getNavigatorPlatform() {
  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };

  return (
    navigatorWithUserAgentData.userAgentData?.platform ?? navigator.platform
  );
}

function isResolvedLinkTarget(value: string) {
  return /^(?:[a-z]+:)?\/\//i.test(value) || value.startsWith("data:");
}

function isLinkTarget(value: string) {
  return isResolvedLinkTarget(value) || value.startsWith("#");
}

function resolveEditableLinkTarget(
  value: string,
  backend: StorageBackend,
  resolveLinkUrl?: (path: string) => string | null,
  fallback = value,
) {
  if (!value) return fallback;
  if (isLinkTarget(value)) return value;
  const linkUrl = resolveLinkUrl?.(value);
  if (linkUrl) return linkUrl;
  return backend.resolveFileUrl(value) ?? fallback;
}

function toTestIdSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getElementFromDomNode(node: Node | null) {
  if (!node) return null;
  return node instanceof Element ? node : node.parentElement;
}

function getContainedSelectionRange(container: HTMLElement) {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const ancestor =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;

  if (!ancestor || !container.contains(ancestor)) {
    return null;
  }

  return range;
}

function findActiveLinkAnchor(
  editor: Editor,
  container: HTMLElement,
): HTMLAnchorElement | null {
  const candidates: Array<Element | null> = [];
  const selection = window.getSelection();

  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    candidates.push(
      getElementFromDomNode(range.startContainer),
      getElementFromDomNode(range.endContainer),
      getElementFromDomNode(range.commonAncestorContainer),
    );
  }

  const { from, to } = editor.state.selection;
  const startDom = editor.view.domAtPos(from);
  const endDom = editor.view.domAtPos(to);
  candidates.push(
    getElementFromDomNode(startDom.node),
    getElementFromDomNode(endDom.node),
  );

  for (const candidate of candidates) {
    const anchor = candidate?.closest("a[href]");

    if (anchor instanceof HTMLAnchorElement && container.contains(anchor)) {
      return anchor;
    }
  }

  return null;
}

function SelectionMenuButton({
  label,
  icon,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const button = (
    <button
      type="button"
      data-testid={`selection-menu-action-${toTestIdSegment(label)}`}
      className={`inline-flex size-9 items-center justify-center rounded-xl border text-slate-600 dark:text-slate-400 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 dark:focus-visible:ring-slate-600 ${
        active
          ? "border-transparent bg-[#E8E3DB] text-black dark:bg-slate-700 dark:text-slate-100"
          : "border-transparent hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100"
      } disabled:cursor-not-allowed disabled:opacity-40`}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
    >
      {icon}
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent data-testid="selection-menu-action-tooltip">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function EditorContextMenu({
  editor,
  backend,
  resolveLinkUrl,
  onAddComment,
  onSuggestDeletion,
  onSuggestReplacement,
  onSuggestInsertion,
  children,
}: EditorContextMenuProps) {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [selectionActionPosition, setSelectionActionPosition] =
    useState<SelectionActionPosition | null>(null);
  const [linkPopoverState, setLinkPopoverState] =
    useState<LinkPopoverState | null>(null);
  const [linkDraft, setLinkDraft] = useState("");
  // Keep the selection menu mounted through its exit animation. `renderedSelectionMenu`
  // retains the last position while closing so the popover can animate out.
  const selectionMenuVisible = Boolean(
    selectionActionPosition && !linkPopoverState,
  );
  const [renderedSelectionMenu, setRenderedSelectionMenu] =
    useState<SelectionActionPosition | null>(null);
  useEffect(() => {
    if (selectionMenuVisible && selectionActionPosition) {
      setRenderedSelectionMenu(selectionActionPosition);
      return;
    }
    if (!selectionMenuVisible && renderedSelectionMenu) {
      const timeout = setTimeout(() => setRenderedSelectionMenu(null), 150);
      return () => clearTimeout(timeout);
    }
  }, [selectionMenuVisible, selectionActionPosition, renderedSelectionMenu]);
  const menuRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const linkPopoverRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const shortcutLabel = getAddCommentShortcutLabel(getNavigatorPlatform());
  const selectionMenuState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      isBoldActive: currentEditor?.isActive("bold") ?? false,
      isItalicActive: currentEditor?.isActive("italic") ?? false,
      isCodeActive: currentEditor?.isActive("code") ?? false,
      isBulletListActive: currentEditor?.isActive("bulletList") ?? false,
      isOrderedListActive: currentEditor?.isActive("orderedList") ?? false,
      isBlockquoteActive: currentEditor?.isActive("blockquote") ?? false,
      isLinkActive: currentEditor?.isActive("link") ?? false,
      activeCriticChangeId:
        (currentEditor?.getAttributes("criticChange").changeId as
          | string
          | null) ?? null,
      canToggleBold:
        currentEditor?.can().chain().focus().toggleBold().run() ?? false,
      canToggleItalic:
        currentEditor?.can().chain().focus().toggleItalic().run() ?? false,
      canToggleCode:
        currentEditor?.can().chain().focus().toggleCode().run() ?? false,
      canToggleBulletList:
        currentEditor?.can().chain().focus().toggleBulletList().run() ?? false,
      canToggleOrderedList:
        currentEditor?.can().chain().focus().toggleOrderedList().run() ?? false,
      canToggleBlockquote:
        currentEditor?.can().chain().focus().toggleBlockquote().run() ?? false,
    }),
  }) ?? {
    isBoldActive: false,
    isItalicActive: false,
    isCodeActive: false,
    isBulletListActive: false,
    isOrderedListActive: false,
    isBlockquoteActive: false,
    isLinkActive: false,
    activeCriticChangeId: null,
    canToggleBold: false,
    canToggleItalic: false,
    canToggleCode: false,
    canToggleBulletList: false,
    canToggleOrderedList: false,
    canToggleBlockquote: false,
  };

  const close = useCallback(() => {
    setPosition(null);
  }, []);

  const closeLinkPopover = useCallback(() => {
    setLinkPopoverState(null);
  }, []);

  const updateSelectionActionPosition = useCallback(() => {
    if (
      !editor?.isFocused ||
      (editor.state.selection.empty && !onSuggestInsertion)
    ) {
      setSelectionActionPosition(null);
      return;
    }

    const container = containerRef.current;
    if (!container) {
      setSelectionActionPosition(null);
      return;
    }

    const range = getContainedSelectionRange(container);

    if (!range) {
      setSelectionActionPosition(null);
      return;
    }

    const boundingRect = range.getBoundingClientRect();
    if (boundingRect.width === 0 && boundingRect.height === 0) {
      setSelectionActionPosition(null);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const nextLeft =
      boundingRect.left + boundingRect.width / 2 - containerRect.left;
    const nextTop = boundingRect.top - containerRect.top - 14;

    setSelectionActionPosition({
      left: nextLeft,
      top: nextTop,
    });
  }, [editor, onSuggestInsertion]);

  const updateLinkPopover = useCallback(() => {
    setLinkPopoverState((current) => {
      if (!current?.existingLink) return current;
      if (!editor || !containerRef.current || !editor.isActive("link")) {
        return null;
      }

      const anchor = findActiveLinkAnchor(editor, containerRef.current);

      if (!anchor) {
        return null;
      }

      const rect = anchor.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        return null;
      }

      const rawHref =
        (editor.getAttributes("link").dataMarkdownSrc as string | null) ||
        anchor.getAttribute("data-markdown-src") ||
        anchor.getAttribute("href") ||
        "";
      const href = resolveEditableLinkTarget(
        rawHref,
        backend,
        resolveLinkUrl,
        (editor.getAttributes("link").href as string | null) || anchor.href,
      );
      const next = {
        ...current,
        href,
        rawHref,
        left: rect.left + rect.width / 2,
        top: rect.top - 12,
      };

      return next.href === current.href &&
        next.rawHref === current.rawHref &&
        next.left === current.left &&
        next.top === current.top
        ? current
        : next;
    });
  }, [backend, editor, resolveLinkUrl]);

  const openExistingLinkPopover = useCallback(
    (anchor: HTMLAnchorElement) => {
      if (!editor) return;

      const firstChild = anchor.firstChild;
      if (firstChild) {
        try {
          const position = editor.view.posAtDOM(firstChild, 0);
          editor.commands.setTextSelection(
            anchor.textContent ? position + 1 : position,
          );
        } catch {
          // Fall back to the current editor selection if the DOM mapping changed.
        }
      }

      const rect = anchor.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      const linkAttrs = editor.isActive("link")
        ? editor.getAttributes("link")
        : {};
      const rawHref =
        (linkAttrs.dataMarkdownSrc as string | null) ||
        anchor.getAttribute("data-markdown-src") ||
        anchor.getAttribute("href") ||
        "";
      const href = resolveEditableLinkTarget(
        rawHref,
        backend,
        resolveLinkUrl,
        (linkAttrs.href as string | null) || anchor.href,
      );

      setLinkPopoverState({
        href,
        rawHref,
        left: rect.left + rect.width / 2,
        top: rect.top - 12,
        existingLink: true,
        focusInput: false,
      });
    },
    [backend, editor, resolveLinkUrl],
  );

  const openLinkPopover = useCallback(() => {
    if (!editor || !containerRef.current) return;

    const anchor = findActiveLinkAnchor(editor, containerRef.current);

    if (anchor) {
      openExistingLinkPopover(anchor);
      return;
    }

    const range = getContainedSelectionRange(containerRef.current);
    if (!range) return;

    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const rawHref =
      (editor.getAttributes("link").dataMarkdownSrc as string | null) || "";

    setLinkPopoverState({
      href: resolveEditableLinkTarget(
        rawHref,
        backend,
        resolveLinkUrl,
        rawHref || "https://",
      ),
      rawHref,
      left: rect.left + rect.width / 2,
      top: rect.top - 12,
      existingLink: false,
      focusInput: true,
    });
  }, [backend, editor, openExistingLinkPopover, resolveLinkUrl]);

  const applyLink = useCallback(
    (nextValue: string) => {
      if (!editor) return;

      const nextHref = nextValue.trim();

      if (!nextHref) {
        editor.chain().focus().unsetLink().run();
        setLinkPopoverState(null);
        return;
      }

      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setMark("link", {
          href: resolveEditableLinkTarget(
            nextHref,
            backend,
            resolveLinkUrl,
            nextHref,
          ),
          dataMarkdownSrc: nextHref,
        })
        .run();
    },
    [backend, editor, resolveLinkUrl],
  );

  useEffect(() => {
    if (!position && !linkPopoverState) return;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (menuRef.current && !menuRef.current.contains(target)) {
        close();
      }

      if (
        linkPopoverRef.current &&
        !linkPopoverRef.current.contains(target) &&
        containerRef.current &&
        !containerRef.current.contains(target)
      ) {
        applyLink(linkDraft);
        closeLinkPopover();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "Escape") closeLinkPopover();
    };

    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [
    applyLink,
    close,
    closeLinkPopover,
    linkDraft,
    linkPopoverState,
    position,
  ]);

  useEffect(() => {
    if (!editor) return;

    const schedulePositionUpdate = () => {
      requestAnimationFrame(() => {
        updateSelectionActionPosition();
        updateLinkPopover();
      });
    };

    const clearSelectionAction = () => {
      setSelectionActionPosition(null);
    };

    const handleSelectionChange = () => {
      schedulePositionUpdate();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !onAddComment ||
        !editor.isFocused ||
        editor.state.selection.empty ||
        !matchesAddCommentShortcut(event, getNavigatorPlatform())
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      onAddComment();
      clearSelectionAction();
    };

    editor.on("selectionUpdate", schedulePositionUpdate);
    editor.on("update", schedulePositionUpdate);
    editor.on("focus", schedulePositionUpdate);
    editor.on("blur", clearSelectionAction);
    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", schedulePositionUpdate);
    window.addEventListener("scroll", schedulePositionUpdate, true);

    schedulePositionUpdate();

    return () => {
      editor.off("selectionUpdate", schedulePositionUpdate);
      editor.off("update", schedulePositionUpdate);
      editor.off("focus", schedulePositionUpdate);
      editor.off("blur", clearSelectionAction);
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", schedulePositionUpdate);
      window.removeEventListener("scroll", schedulePositionUpdate, true);
    };
  }, [editor, onAddComment, updateLinkPopover, updateSelectionActionPosition]);

  useEffect(() => {
    if (!linkPopoverState) return;
    setLinkDraft(linkPopoverState.rawHref);
  }, [linkPopoverState]);

  useEffect(() => {
    if (!linkPopoverState?.focusInput || !linkInputRef.current) {
      return;
    }

    requestAnimationFrame(() => {
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
    });
  }, [linkPopoverState]);

  const handlePasteText = useCallback(async () => {
    if (!editor) return;

    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        editor.chain().focus().insertContent(text).run();
      }
    } finally {
      close();
    }
  }, [close, editor]);

  const handlePasteMarkdown = useCallback(async () => {
    if (!editor) return;

    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        editor
          .chain()
          .focus()
          .insertContent(
            toHtml(text, {
              resolveFileUrl: (path) => backend.resolveFileUrl(path),
              resolveLinkUrl,
            }),
          )
          .run();
      }
    } finally {
      close();
    }
  }, [backend, close, editor, resolveLinkUrl]);

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseDownCapture={(event) => {
        if (!editor || !containerRef.current) return;

        const target = event.target as Node;
        const candidate = getElementFromDomNode(target);
        const anchor = candidate?.closest("a[href]");

        if (
          !(anchor instanceof HTMLAnchorElement) ||
          !containerRef.current.contains(anchor)
        ) {
          return;
        }

        event.preventDefault();
        openExistingLinkPopover(anchor);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setPosition({ x: event.clientX, y: event.clientY });
      }}
    >
      {children}
      {renderedSelectionMenu ? (
        <div
          className="absolute z-30 -translate-x-1/2 -translate-y-full"
          style={{
            left: renderedSelectionMenu.left,
            top: renderedSelectionMenu.top,
          }}
        >
          <div
            data-testid="selection-menu"
            data-state={selectionMenuVisible ? "open" : "closed"}
            className="w-max max-w-[calc(100vw-2rem)] origin-bottom rounded-2xl border border-slate-200/90 dark:border-slate-700/90 bg-white/95 dark:bg-slate-800/95 p-2 shadow-[0_18px_48px_rgba(15,23,42,0.16)] dark:shadow-[0_18px_48px_rgba(0,0,0,0.4)] backdrop-blur-xl duration-150 ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-85 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-85"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <div className="flex flex-wrap items-center gap-1">
              <SelectionMenuButton
                label="Bold"
                icon={<Bold className="size-4" />}
                active={selectionMenuState.isBoldActive}
                disabled={!selectionMenuState.canToggleBold}
                onClick={() => editor?.chain().focus().toggleBold().run()}
              />
              <SelectionMenuButton
                label="Italic"
                icon={<Italic className="size-4" />}
                active={selectionMenuState.isItalicActive}
                disabled={!selectionMenuState.canToggleItalic}
                onClick={() => editor?.chain().focus().toggleItalic().run()}
              />
              <SelectionMenuButton
                label="Inline code"
                icon={<Code2 className="size-4" />}
                active={selectionMenuState.isCodeActive}
                disabled={!selectionMenuState.canToggleCode}
                onClick={() => editor?.chain().focus().toggleCode().run()}
              />
              <SelectionMenuButton
                label="Blockquote"
                icon={<Quote className="size-4" />}
                active={selectionMenuState.isBlockquoteActive}
                disabled={!selectionMenuState.canToggleBlockquote}
                onClick={() => editor?.chain().focus().toggleBlockquote().run()}
              />
              <SelectionMenuButton
                label="Bulleted list"
                icon={<List className="size-4" />}
                active={selectionMenuState.isBulletListActive}
                disabled={!selectionMenuState.canToggleBulletList}
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
              />
              <SelectionMenuButton
                label="Numbered list"
                icon={<ListOrdered className="size-4" />}
                active={selectionMenuState.isOrderedListActive}
                disabled={!selectionMenuState.canToggleOrderedList}
                onClick={() =>
                  editor?.chain().focus().toggleOrderedList().run()
                }
              />
              <SelectionMenuButton
                label="Link"
                icon={<Link2 className="size-4" />}
                active={selectionMenuState.isLinkActive}
                onClick={openLinkPopover}
              />
            </div>
            {selectionMenuState.activeCriticChangeId ? (
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  data-testid="selection-menu-action-accept-suggestion"
                  className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={() => {
                    if (selectionMenuState.activeCriticChangeId) {
                      editor
                        ?.chain()
                        .focus()
                        .acceptCriticChange(
                          selectionMenuState.activeCriticChangeId,
                        )
                        .run();
                    }
                    setSelectionActionPosition(null);
                  }}
                >
                  <Check className="size-4" />
                  <span>Accept</span>
                </button>
                <button
                  type="button"
                  data-testid="selection-menu-action-reject-suggestion"
                  className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={() => {
                    if (selectionMenuState.activeCriticChangeId) {
                      editor
                        ?.chain()
                        .focus()
                        .rejectCriticChange(
                          selectionMenuState.activeCriticChangeId,
                        )
                        .run();
                    }
                    setSelectionActionPosition(null);
                  }}
                >
                  <X className="size-4" />
                  <span>Reject</span>
                </button>
              </div>
            ) : null}
            <button
              type="button"
              data-testid="selection-menu-action-comment"
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#E8E3DB] px-3 py-2 text-left text-sm font-bold text-black shadow-[inset_0_1px_0_rgba(255,251,245,0.72)] transition hover:bg-[#ded8ce] focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] dark:hover:bg-slate-600 dark:focus-visible:ring-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!onAddComment || editor?.state.selection.empty}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={() => {
                onAddComment?.();
                setSelectionActionPosition(null);
              }}
            >
              <span className="inline-flex items-center gap-2">
                <MessageSquarePlus className="size-4.5" />
                <span>Comment</span>
              </span>
            </button>
          </div>
        </div>
      ) : null}
      {linkPopoverState ? (
        <div
          ref={linkPopoverRef}
          data-testid="link-popover"
          className="fixed z-[220] flex -translate-x-1/2 -translate-y-full items-center rounded-[18px] border border-slate-200/90 dark:border-slate-700/90 bg-white/95 dark:bg-slate-800/95 px-3 py-2 shadow-[0_18px_48px_rgba(15,23,42,0.16)] dark:shadow-[0_18px_48px_rgba(0,0,0,0.4)] backdrop-blur-xl"
          style={{
            left: linkPopoverState.left,
            top: linkPopoverState.top,
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
        >
          <input
            ref={linkInputRef}
            value={linkDraft}
            onChange={(event) => setLinkDraft(event.target.value)}
            onBlur={(event) => {
              const nextFocused = event.relatedTarget as Node | null;

              if (
                nextFocused &&
                linkPopoverRef.current?.contains(nextFocused)
              ) {
                return;
              }

              applyLink(linkDraft);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink(linkDraft);
                editor?.commands.focus();
              }

              if (event.key === "Escape") {
                event.preventDefault();
                closeLinkPopover();
                editor?.commands.focus();
              }
            }}
            className="h-10 w-[22rem] border-0 bg-transparent px-2 text-[17px] text-slate-900 dark:text-slate-100 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
            placeholder="https://example.com"
            aria-label="Link URL"
            data-testid="link-url-input"
          />
          <div
            className="mx-2 h-8 w-px bg-slate-200 dark:bg-slate-700"
            aria-hidden="true"
          />
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 dark:focus-visible:ring-slate-600"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              applyLink(linkDraft);
              const target =
                resolveEditableLinkTarget(
                  linkDraft.trim(),
                  backend,
                  resolveLinkUrl,
                ) || linkPopoverState.href;

              if (target) {
                window.open(target, "_blank", "noopener,noreferrer");
              }
            }}
            aria-label="Open link in new tab"
            data-testid="link-action-open"
            title="Open link in new tab"
          >
            <ExternalLink className="size-5" />
          </button>
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 transition hover:bg-rose-50 dark:hover:bg-rose-900/40 hover:text-rose-600 dark:hover:text-rose-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 dark:focus-visible:ring-rose-800"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              editor?.chain().focus().unsetLink().run();
              closeLinkPopover();
            }}
            aria-label="Delete link"
            data-testid="link-action-delete"
            title="Delete link"
          >
            <Trash2 className="size-5" />
          </button>
        </div>
      ) : null}
      {position ? (
        <div
          ref={menuRef}
          data-testid="editor-context-menu"
          className="fixed z-[200] min-w-44 rounded-2xl border border-slate-200/90 dark:border-slate-700/90 bg-white/95 dark:bg-slate-800/95 p-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.16)] dark:shadow-[0_18px_48px_rgba(0,0,0,0.4)] backdrop-blur-xl"
          style={{ left: position.x, top: position.y }}
        >
          <button
            type="button"
            data-testid="editor-context-menu-action-add-comment"
            className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-300 transition hover:bg-slate-50 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!editor || editor.state.selection.empty}
            onClick={() => {
              onAddComment?.();
              close();
            }}
          >
            <span>Add comment</span>
            <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
              {shortcutLabel}
            </span>
          </button>
          <button
            type="button"
            data-testid="editor-context-menu-action-suggest-insertion"
            className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-300 transition hover:bg-slate-50 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!editor || !onSuggestInsertion}
            onClick={() => {
              onSuggestInsertion?.();
              close();
            }}
          >
            Suggest insertion
          </button>
          <button
            type="button"
            data-testid="editor-context-menu-action-suggest-deletion"
            className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-300 transition hover:bg-slate-50 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!editor || editor.state.selection.empty}
            onClick={() => {
              onSuggestDeletion?.();
              close();
            }}
          >
            Suggest deletion
          </button>
          <button
            type="button"
            data-testid="editor-context-menu-action-suggest-replacement"
            className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-300 transition hover:bg-slate-50 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!editor || editor.state.selection.empty}
            onClick={() => {
              onSuggestReplacement?.();
              close();
            }}
          >
            Suggest replacement
          </button>
          {selectionMenuState.activeCriticChangeId ? (
            <>
              <div
                className="my-1 h-px bg-slate-100 dark:bg-slate-700"
                aria-hidden="true"
              />
              <button
                type="button"
                data-testid="editor-context-menu-action-accept-suggestion"
                className="block w-full rounded-xl px-3 py-2 text-left text-sm text-emerald-700 transition hover:bg-emerald-50"
                onClick={() => {
                  if (selectionMenuState.activeCriticChangeId) {
                    editor
                      ?.chain()
                      .focus()
                      .acceptCriticChange(
                        selectionMenuState.activeCriticChangeId,
                      )
                      .run();
                  }
                  close();
                }}
              >
                Accept suggestion
              </button>
              <button
                type="button"
                data-testid="editor-context-menu-action-reject-suggestion"
                className="block w-full rounded-xl px-3 py-2 text-left text-sm text-rose-700 transition hover:bg-rose-50"
                onClick={() => {
                  if (selectionMenuState.activeCriticChangeId) {
                    editor
                      ?.chain()
                      .focus()
                      .rejectCriticChange(
                        selectionMenuState.activeCriticChangeId,
                      )
                      .run();
                  }
                  close();
                }}
              >
                Reject suggestion
              </button>
            </>
          ) : null}
          <button
            type="button"
            data-testid="editor-context-menu-action-paste"
            className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-300 transition hover:bg-slate-50 dark:hover:bg-slate-700"
            onClick={() => void handlePasteText()}
          >
            Paste
          </button>
          <button
            type="button"
            data-testid="editor-context-menu-action-paste-markdown"
            className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-300 transition hover:bg-slate-50 dark:hover:bg-slate-700"
            onClick={() => void handlePasteMarkdown()}
          >
            Paste Markdown
          </button>
        </div>
      ) : null}
    </div>
  );
}
