import { ClickAwayListener } from "@mui/base/ClickAwayListener";
import { Button, Dropdown, IconButton, Input, Menu, MenuButton, Tooltip } from "@mui/joy";
import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import Icon from "@/components/Icon";
import useCurrentUser from "@/hooks/useCurrentUser";
import i18n from "@/i18n";
import { useFilterStore } from "@/store/module";
import { useMemoStore } from "@/store/v1";
import { Visibility, Memo } from "@/types/proto/api/v2/memo_service";
import { EditorRefActions } from "../Editor";
import {
  DEFAULT_TEMPLATE_PRESET,
  ParsedTemplate,
  formatTemplateString,
  parseTemplateFromMemo,
  subscribeApplyTemplate,
} from "./templateUtils";

interface Props {
  editorRef: React.RefObject<EditorRefActions>;
  onOpenNestedEditor?: () => void;
}

const TemplateSelector: React.FC<Props> = ({ editorRef, onOpenNestedEditor }: Props) => {
  const currentUser = useCurrentUser();
  const memoStore = useMemoStore();
  const filterStore = useFilterStore();
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [localTemplates, setLocalTemplates] = useState<ParsedTemplate[]>([]);

  const memoMap = useMemoStore((state) => state.memoMapById);

  const templates: ParsedTemplate[] = useMemo(() => {
    const map = new Map<number, ParsedTemplate>();
    // 1. From local fetched list
    for (const t of localTemplates) {
      map.set(t.id, t);
    }
    // 2. From global memo store
    for (const memo of Object.values(memoMap) as Memo[]) {
      const parsed = parseTemplateFromMemo(memo);
      if (parsed) {
        map.set(parsed.id, parsed);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.id - a.id);
  }, [localTemplates, memoMap]);

  const fetchTemplates = async () => {
    if (!currentUser) return;
    try {
      setIsLoading(true);
      const results = await Promise.allSettled([
        memoStore.fetchMemos({
          filter: `creator == "${currentUser.name}" && row_status == "NORMAL" && content_search == ["#template"]`,
          limit: 50,
        }),
        memoStore.fetchMemos({
          filter: `creator == "${currentUser.name}" && row_status == "NORMAL" && content_search == ["#模板"]`,
          limit: 50,
        }),
      ]);

      const fetchedList: ParsedTemplate[] = [];
      results.forEach((res) => {
        if (res.status === "fulfilled" && Array.isArray(res.value)) {
          for (const memo of res.value) {
            const parsed = parseTemplateFromMemo(memo);
            if (parsed) {
              fetchedList.push(parsed);
            }
          }
        }
      });

      if (fetchedList.length > 0) {
        setLocalTemplates(fetchedList);
      }
    } catch (e) {
      console.error("Failed to fetch template memos", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser?.name) {
      fetchTemplates();
    }
  }, [currentUser?.name]);

  useEffect(() => {
    if (open) {
      fetchTemplates();
      setShowSaveInput(false);
      setTemplateName("");
    }
  }, [open]);

  // Subscribe to external apply events (e.g. from MemoView "⚡ 套用模板")
  useEffect(() => {
    const unsubscribe = subscribeApplyTemplate((tpl) => {
      handleApplyTemplate(tpl);
    });
    return () => unsubscribe();
  }, []);

  const handleApplyTemplate = (template: ParsedTemplate) => {
    if (!editorRef.current) return;

    const formattedContent = formatTemplateString(template.body, i18n.language);
    const currentContent = editorRef.current.getContent();

    if (currentContent.trim() === "") {
      editorRef.current.setContent(formattedContent);
    } else {
      const prefix = currentContent.endsWith("\n") ? "" : "\n\n";
      editorRef.current.insertText(formattedContent, prefix);
    }

    toast.success(`已套用模板: ${template.title}`, { id: "apply-template" });
    setOpen(false);

    setTimeout(() => {
      editorRef.current?.scrollToCursor();
      editorRef.current?.focus();
    }, 50);
  };

  const handleSaveAsTemplate = async () => {
    const content = editorRef.current?.getContent()?.trim() || "";
    if (!content) {
      toast.error("当前编辑器内容为空，无法存为模板");
      return;
    }

    const title = templateName.trim() || "未命名模板";
    const templateMemoContent = `#模板 ${title}\n${content}`;

    try {
      setIsSaving(true);
      const newMemo = await memoStore.createMemo({
        content: templateMemoContent,
        visibility: Visibility.PRIVATE,
      });
      const parsed = parseTemplateFromMemo(newMemo);
      if (parsed) {
        setLocalTemplates((prev) => [parsed, ...prev]);
      }
      toast.success(`模板「${title}」已保存至云端！`);
      setShowSaveInput(false);
      setTemplateName("");
      fetchTemplates();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "创建模板失败");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateDefaultPreset = async () => {
    try {
      setIsSaving(true);
      const newMemo = await memoStore.createMemo({
        content: DEFAULT_TEMPLATE_PRESET.content,
        visibility: Visibility.PRIVATE,
      });
      const parsed = parseTemplateFromMemo(newMemo);
      if (parsed) {
        setLocalTemplates((prev) => [parsed, ...prev]);
      }
      toast.success("已创建「每日打卡」示例模板！");
      fetchTemplates();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "创建示例失败");
    } finally {
      setIsSaving(false);
    }
  };

  const handleViewAllTemplates = () => {
    filterStore.setTagFilter("模板");
    setOpen(false);
  };

  return (
    <Dropdown open={open} onOpenChange={(_, isOpen) => setOpen(isOpen)}>
      <Tooltip title="模板" placement="top">
        <MenuButton slots={{ root: IconButton }} slotProps={{ root: { size: "sm" } }}>
          <Icon.LayoutTemplate className="w-5 h-5 mx-auto" />
        </MenuButton>
      </Tooltip>

      <Menu className="w-72 max-w-[90vw] text-sm !p-1.5 shadow-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded-lg z-50" placement="bottom-start">
        <ClickAwayListener onClickAway={() => setOpen(false)}>
          <div className="flex flex-col gap-1 w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-2 py-1 text-xs text-zinc-400 dark:text-zinc-500 font-medium border-b border-zinc-100 dark:border-zinc-800/80">
              <span className="flex items-center gap-1">
                <Icon.LayoutTemplate className="w-3.5 h-3.5 text-indigo-500" />
                <span className="font-semibold text-zinc-700 dark:text-zinc-200">笔记模板</span>
              </span>
              <span className="text-[11px] text-zinc-400 font-mono">#模板 / #template</span>
            </div>

            {/* Nested Editor Workshop Trigger */}
            {onOpenNestedEditor && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenNestedEditor();
                }}
                className="w-full text-left px-2 py-1.5 rounded-md bg-indigo-50/80 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 transition-colors flex items-center justify-between cursor-pointer border border-indigo-200/80 dark:border-indigo-800/60"
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  <Icon.Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span>📐 打开模板工坊 (嵌套卡片)</span>
                </span>
                <span className="text-[10px] px-1 py-0.2 bg-white dark:bg-zinc-800 rounded text-indigo-600 dark:text-indigo-300 font-medium border border-indigo-200 dark:border-indigo-800">
                  新建
                </span>
              </button>
            )}

            <div className="flex flex-col max-h-56 overflow-y-auto py-1">
              {templates.length > 0 ? (
                templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => handleApplyTemplate(tpl)}
                    className="w-full text-left px-2 py-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-700/60 transition-colors group cursor-pointer flex flex-col gap-0.5"
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="font-medium text-xs text-zinc-800 dark:text-zinc-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 truncate">
                        {tpl.title}
                      </span>
                      <Icon.ArrowRight className="w-3 h-3 text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </div>
                    {tpl.body && (
                      <span className="text-[11px] text-zinc-400 dark:text-zinc-500 line-clamp-1 truncate font-mono">
                        {tpl.body.replace(/\n/g, " ")}
                      </span>
                    )}
                  </button>
                ))
              ) : (
                <div className="py-3 px-2 text-center text-xs text-zinc-400 dark:text-zinc-500 flex flex-col items-center gap-2">
                  <span>{isLoading ? "正在同步模板..." : "暂无模板卡片"}</span>
                  {!isLoading && (
                    <Button
                      size="sm"
                      variant="soft"
                      color="primary"
                      onClick={handleCreateDefaultPreset}
                      loading={isSaving}
                      startDecorator={<Icon.Plus className="w-3.5 h-3.5" />}
                      className="text-xs !py-1"
                    >
                      创建「每日打卡」示例
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="pt-1 mt-1 border-t border-zinc-100 dark:border-zinc-800 flex flex-col gap-1">
              {!showSaveInput ? (
                <button
                  type="button"
                  onClick={() => setShowSaveInput(true)}
                  className="w-full text-left px-2 py-1 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700/60 rounded flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Icon.Plus className="w-3.5 h-3.5 text-blue-500" />
                  <span>将当前内容存为新模板</span>
                </button>
              ) : (
                <div className="p-1 flex flex-col gap-1.5 bg-zinc-50 dark:bg-zinc-900/60 rounded border border-zinc-200 dark:border-zinc-700">
                  <Input
                    size="sm"
                    autoFocus
                    placeholder="输入模板名称 (如: 每日复盘)"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSaveAsTemplate();
                      }
                    }}
                  />
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" variant="plain" color="neutral" onClick={() => setShowSaveInput(false)} className="!text-xs !py-0.5">
                      取消
                    </Button>
                    <Button size="sm" color="primary" onClick={handleSaveAsTemplate} loading={isSaving} className="!text-xs !py-0.5">
                      确认保存
                    </Button>
                  </div>
                </div>
              )}

              {templates.length > 0 && (
                <button
                  type="button"
                  onClick={handleViewAllTemplates}
                  className="w-full text-left px-2 py-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700/60 rounded flex items-center justify-between transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <Icon.Tag className="w-3.5 h-3.5" />
                    <span>查看与管理所有 #模板</span>
                  </span>
                  <Icon.ExternalLink className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </ClickAwayListener>
      </Menu>
    </Dropdown>
  );
};

export default TemplateSelector;

