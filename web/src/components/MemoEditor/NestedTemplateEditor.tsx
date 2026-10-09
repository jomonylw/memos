import { ClickAwayListener } from "@mui/base/ClickAwayListener";
import { Button, IconButton, Option, Select } from "@mui/joy";
import React, { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import Icon from "@/components/Icon";
import i18n from "@/i18n";
import { useTagStore } from "@/store/module";
import { useMemoStore } from "@/store/v1";
import { Visibility } from "@/types/proto/api/v2/memo_service";
import { convertVisibilityToString } from "@/utils/memo";
import { ParsedTemplate, TEMPLATE_VARIABLES, formatTemplateString, parseTemplateFromMemo } from "./ActionButton/templateUtils";
import { EditorRefActions } from "./Editor";
import TagSuggestions from "./Editor/TagSuggestions";

interface Props {
  initialContent?: string;
  onClose: () => void;
  onSaved?: (template: ParsedTemplate) => void;
}

const NestedTemplateEditor: React.FC<Props> = ({ initialContent = "", onClose, onSaved }: Props) => {
  const memoStore = useMemoStore();
  const tagStore = useTagStore();
  const tags = tagStore.state.tags;

  const [title, setTitle] = useState("");
  const [content, setContent] = useState(initialContent);
  const [visibility, setVisibility] = useState<Visibility>(Visibility.PRIVATE);
  const [showPreview, setShowPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // 标签选择与搜索浮层状态
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false);
  const [tagSearchText, setTagSearchText] = useState("");

  const titleInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tagSearchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 展开模板工坊时，自动对焦到标题输入框
    titleInputRef.current?.focus();
    // 拉取用户最新标签列表
    (async () => {
      try {
        await tagStore.fetchTags();
      } catch (e) {
        // do nothing
      }
    })();
  }, []);

  const insertText = useCallback((text = "", prefix = "", suffix = "") => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setContent((prev) => prev + prefix + text + suffix);
      return;
    }

    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const prevValue = textarea.value;
    const inserted = prefix + (text || prevValue.slice(start, end)) + suffix;
    const nextValue = prevValue.slice(0, start) + inserted + prevValue.slice(end);

    textarea.value = nextValue;
    const nextCursor = start + inserted.length;
    textarea.setSelectionRange(nextCursor, nextCursor);
    textarea.focus();
    setContent(nextValue);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(nextCursor, nextCursor);
      }
    }, 10);
  }, []);

  const removeText = useCallback((start: number, length: number) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const prevValue = textarea.value;
    const nextValue = prevValue.slice(0, start) + prevValue.slice(start + length);

    textarea.value = nextValue;
    textarea.setSelectionRange(start, start);
    textarea.focus();
    setContent(nextValue);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(start, start);
      }
    }, 10);
  }, []);

  const handleInsertVariable = (variableToken: string) => {
    insertText(variableToken);
  };

  const handleInsertTag = (tag: string) => {
    const cleanTag = tag.replace(/^#/, "").trim();
    if (!cleanTag) return;
    insertText(`#${cleanTag} `);
    setIsTagDropdownOpen(false);
    setTagSearchText("");
  };

  // 为 TagSuggestions 键盘补全提供 actions 接口
  const editorActionsRef = useRef<EditorRefActions>({
    focus: () => textareaRef.current?.focus(),
    scrollToCursor: () => {
      if (textareaRef.current) {
        textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
      }
    },
    insertText,
    removeText,
    setContent: (text: string) => {
      if (textareaRef.current) {
        textareaRef.current.value = text;
      }
      setContent(text);
    },
    getContent: () => textareaRef.current?.value ?? content,
    getSelectedContent: () => {
      const textarea = textareaRef.current;
      if (!textarea) return "";
      return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
    },
    getCursorPosition: () => textareaRef.current?.selectionStart ?? 0,
    setCursorPosition: (startPos: number, endPos?: number) => {
      textareaRef.current?.setSelectionRange(startPos, endPos ?? startPos);
    },
    getCursorLineNumber: () => 0,
    getLine: () => "",
    setLine: () => {},
  });

  useEffect(() => {
    editorActionsRef.current.insertText = insertText;
    editorActionsRef.current.removeText = removeText;
    editorActionsRef.current.getContent = () => textareaRef.current?.value ?? content;
    editorActionsRef.current.setContent = (text: string) => {
      if (textareaRef.current) {
        textareaRef.current.value = text;
      }
      setContent(text);
    };
  }, [insertText, removeText, content]);

  const handleSave = async () => {
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();

    if (!trimmedContent) {
      toast.error("请输入模板正文内容");
      textareaRef.current?.focus();
      return;
    }

    const finalTitle = trimmedTitle || "未命名模板";
    const fullMemoContent = `#模板 ${finalTitle}\n${trimmedContent}`;

    try {
      setIsSaving(true);
      const newMemo = await memoStore.createMemo({
        content: fullMemoContent,
        visibility,
      });

      toast.success(`模板「${finalTitle}」已保存！可在模板菜单与时间线中直接套用`);
      const parsed = parseTemplateFromMemo(newMemo);
      if (parsed && onSaved) {
        onSaved(parsed);
      }
      onClose();
    } catch (e: any) {
      console.error("Failed to save template", e);
      toast.error(e?.message || "保存模板失败");
    } finally {
      setIsSaving(false);
    }
  };

  const previewContent = formatTemplateString(content, i18n.language);

  const filteredTags = tags.filter((t) => t.toLowerCase().includes(tagSearchText.trim().toLowerCase()));

  return (
    <div
      className="w-full my-2 p-3.5 sm:p-4 rounded-xl border-2 border-dashed border-indigo-400 dark:border-indigo-500 bg-indigo-50/50 dark:bg-zinc-900/90 shadow-md transition-all flex flex-col gap-3"
      onFocus={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          handleSave();
        }
      }}
    >
      {/* Header */}
      <div className="flex flex-row items-center justify-between pb-2 border-b border-indigo-100 dark:border-indigo-900/50">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-600 text-white shadow-sm">
            <Icon.LayoutTemplate className="w-3.5 h-3.5" />
            <span>模板工坊</span>
          </span>
          <span className="text-xs text-indigo-900/70 dark:text-indigo-300 font-medium hidden sm:inline">正在设计可复用的笔记母版</span>
        </div>
        <IconButton size="sm" variant="plain" color="neutral" onClick={onClose} className="!p-1 text-zinc-400 hover:text-zinc-600">
          <Icon.X className="w-4 h-4" />
        </IconButton>
      </div>
      {/* Template Title Input */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-1">
            <span>🏷️ 模板标题</span>
            <span className="text-red-500">*</span>
          </label>
          <span className="text-[11px] text-zinc-400">将自动以 #模板 分组</span>
        </div>
        <input
          ref={titleInputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="例如: 每日打卡、周报复盘、读书摘录..."
          className="w-full text-sm px-3 py-1.5 rounded-lg border border-indigo-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder-zinc-400 transition"
        />
      </div>

      {/* Dynamic Variable Toolbar */}
      <div className="flex flex-col gap-1.5 bg-indigo-100/40 dark:bg-zinc-800/60 p-2 rounded-lg border border-indigo-100 dark:border-zinc-700/60">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-indigo-900 dark:text-indigo-300 flex items-center gap-1">
            <Icon.Sparkles className="w-3 h-3 text-indigo-500" />
            <span>点击插入动态时间变量 (套用时自动计算当天值):</span>
          </span>
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-0.5 cursor-pointer"
          >
            <Icon.Eye className="w-3 h-3" />
            <span>{showPreview ? "收起预览" : "实时解析预览"}</span>
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {TEMPLATE_VARIABLES.map((v) => (
            <button
              key={v.token}
              type="button"
              onClick={() => handleInsertVariable(v.token)}
              title={`${v.label} (如: ${v.example})`}
              className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-white dark:bg-zinc-700 text-indigo-700 dark:text-indigo-200 border border-indigo-200 dark:border-zinc-600 hover:bg-indigo-50 hover:border-indigo-400 dark:hover:bg-zinc-600 transition cursor-pointer flex items-center gap-1 shadow-xs"
            >
              <span>{v.token}</span>
              <span className="text-[10px] text-zinc-400 dark:text-zinc-400 font-sans">({v.label})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tag Selector Toolbar */}
      <div className="flex flex-col gap-1.5 bg-indigo-100/40 dark:bg-zinc-800/60 p-2 rounded-lg border border-indigo-100 dark:border-zinc-700/60">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-indigo-900 dark:text-indigo-300 flex items-center gap-1">
            <Icon.Tag className="w-3 h-3 text-indigo-500" />
            <span>选择输入标签 (点击插入至正文):</span>
          </span>
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500 hidden sm:inline">正文中输入 # 亦可实时补全</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 relative">
          {tags.slice(0, 6).map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => handleInsertTag(tag)}
              title={`点击在光标处插入 #${tag}`}
              className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-white dark:bg-zinc-700 text-indigo-700 dark:text-indigo-200 border border-indigo-200 dark:border-zinc-600 hover:bg-indigo-50 hover:border-indigo-400 dark:hover:bg-zinc-600 transition cursor-pointer flex items-center gap-0.5 shadow-xs"
            >
              <span>#{tag}</span>
            </button>
          ))}

          <div className="relative inline-block">
            <button
              type="button"
              onClick={() => {
                const nextOpen = !isTagDropdownOpen;
                setIsTagDropdownOpen(nextOpen);
                if (nextOpen) {
                  setTimeout(() => tagSearchInputRef.current?.focus(), 60);
                }
              }}
              className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition cursor-pointer flex items-center gap-1 shadow-xs"
            >
              <Icon.Hash className="w-3 h-3" />
              <span>{tags.length > 6 ? `更多标签 (${tags.length}) ▾` : "选择/搜索标签 ▾"}</span>
            </button>

            {isTagDropdownOpen && (
              <ClickAwayListener onClickAway={() => setIsTagDropdownOpen(false)}>
                <div
                  className="absolute top-full left-0 mt-1 z-30 w-64 max-w-[90vw] p-2 rounded-xl bg-white dark:bg-zinc-800 shadow-xl border border-indigo-200 dark:border-zinc-700 flex flex-col gap-2"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <div className="relative w-full">
                    <Icon.Search className="w-3.5 h-3.5 absolute left-2 top-2 text-zinc-400" />
                    <input
                      ref={tagSearchInputRef}
                      type="text"
                      value={tagSearchText}
                      onChange={(e) => setTagSearchText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (tagSearchText.trim()) {
                            handleInsertTag(tagSearchText.trim());
                          } else if (filteredTags.length > 0) {
                            handleInsertTag(filteredTags[0]);
                          }
                        } else if (e.key === "Escape") {
                          setIsTagDropdownOpen(false);
                        }
                      }}
                      placeholder="搜索或输入新标签..."
                      className="w-full pl-7 pr-2 py-1 text-xs rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto p-0.5 font-mono">
                    {filteredTags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => handleInsertTag(tag)}
                        className="text-xs px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-zinc-600 dark:hover:text-indigo-300 transition cursor-pointer flex items-center"
                      >
                        <span>#{tag}</span>
                      </button>
                    ))}
                    {filteredTags.length === 0 && !tagSearchText.trim() && (
                      <span className="text-xs text-zinc-400 py-1 px-1 italic font-sans">暂无标签，输入名称后回车即可插入</span>
                    )}
                  </div>

                  {tagSearchText.trim() && !tags.includes(tagSearchText.trim()) && (
                    <button
                      type="button"
                      onClick={() => handleInsertTag(tagSearchText.trim())}
                      className="w-full text-left text-xs px-2 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 font-medium flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <Icon.Plus className="w-3.5 h-3.5" />
                      <span>插入新标签 #{tagSearchText.trim()}</span>
                    </button>
                  )}
                </div>
              </ClickAwayListener>
            )}
          </div>
        </div>
      </div>

      {/* Template Body Editor */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-1">
          <span>📝 模板内容 (支持 Markdown、待办清单与业务标签)</span>
        </label>
        <div className="relative w-full">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onFocus={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
            }}
            placeholder={`例如:\n#工作 #复盘 {{date}} {{weekday_short}}\n- [ ] 核心目标完成情况：\n- [ ] 遇到的问题与解决方案：\n- [ ] 明日计划：`}
            rows={5}
            className="w-full text-sm font-normal p-3 rounded-lg border border-indigo-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder-zinc-400 transition resize-y font-mono"
          />
          <TagSuggestions editorRef={textareaRef} editorActions={editorActionsRef} />
        </div>
      </div>

      {/* Live Preview Panel */}
      {showPreview && (
        <div className="p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700/80 text-xs">
          <div className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">
            <Icon.CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
            <span>今天套用时的实际生成预览：</span>
          </div>
          <pre className="whitespace-pre-wrap font-mono text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 p-2 rounded border border-zinc-100 dark:border-zinc-700">
            {previewContent || "<请输入内容>"}
          </pre>
        </div>
      )}

      {/* Footer Controls: Visibility + Action Buttons */}
      <div className="flex flex-row items-center justify-between pt-1 border-t border-indigo-100 dark:border-indigo-900/50">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">权限:</span>
          <Select
            size="sm"
            value={visibility}
            onChange={(_, val) => val && setVisibility(val)}
            className="!text-xs !min-h-[28px] !h-[28px]"
          >
            <Option value={Visibility.PRIVATE}>{convertVisibilityToString(Visibility.PRIVATE)}</Option>
            <Option value={Visibility.PROTECTED}>{convertVisibilityToString(Visibility.PROTECTED)}</Option>
            <Option value={Visibility.PUBLIC}>{convertVisibilityToString(Visibility.PUBLIC)}</Option>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="plain" color="neutral" onClick={onClose} disabled={isSaving} className="!text-xs !py-1">
            取消
          </Button>
          <Button
            size="sm"
            color="primary"
            onClick={handleSave}
            loading={isSaving}
            startDecorator={<Icon.Save className="w-3.5 h-3.5" />}
            className="!text-xs !py-1 !bg-indigo-600 hover:!bg-indigo-700 text-white shadow-sm"
          >
            保存为模板卡片
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NestedTemplateEditor;
