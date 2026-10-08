import { Button, IconButton, Input, Option, Select, Textarea } from "@mui/joy";
import copy from "copy-to-clipboard";
import React, { useState } from "react";
import { toast } from "react-hot-toast";
import { getVoiceMemoSetting, setVoiceMemoSetting, transcribeAudioWithDeepgram, STTLanguage } from "@/helpers/stt";
import { useMemoStore } from "@/store/v1";
import { Resource } from "@/types/proto/api/v2/resource_service";
import { getResourceUrl } from "@/utils/resource";
import { generateDialog } from "./Dialog";
import Icon from "./Icon";

interface Props extends DialogProps {
  resource: Resource;
  memoId?: number;
  onTranscribeText?: (text: string) => void;
}

const AudioTranscriptionDialog: React.FC<Props> = ({ destroy, resource, memoId, onTranscribeText }: Props) => {
  const memoStore = useMemoStore();
  const initialSetting = getVoiceMemoSetting();

  const [apiKey, setApiKey] = useState(initialSetting.deepgramApiKey);
  const [language, setLanguage] = useState<STTLanguage>(initialSetting.sttLanguage);
  const [model] = useState(initialSetting.sttModel || "nova-3");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSavingMemo, setIsSavingMemo] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [hasCopied, setHasCopied] = useState(false);

  const resourceUrl = getResourceUrl(resource);

  const handleStartTranscribe = async () => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      toast.error("请先输入 Deepgram API Key");
      return;
    }

    setVoiceMemoSetting({
      deepgramApiKey: trimmedKey,
      sttLanguage: language,
    });

    setIsTranscribing(true);
    setErrorMsg("");

    try {
      const response = await fetch(resourceUrl);
      if (!response.ok) {
        throw new Error(`获取音频文件失败 (HTTP ${response.status})`);
      }
      const audioBlob = await response.blob();
      const text = await transcribeAudioWithDeepgram(audioBlob, {
        apiKey: trimmedKey,
        model,
        language,
      });

      if (!text) {
        toast("转写完成，但未识别到有效语音内容", { icon: "ℹ️" });
        setTranscript("（未检测到有效语音文字）");
      } else {
        setTranscript(text);
        toast.success("转写成功！");
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "转写失败，请检查网络或密钥");
      toast.error(err.message || "转写失败");
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleCopy = () => {
    if (!transcript) return;
    copy(transcript);
    setHasCopied(true);
    toast.success("已复制转写文本到剪贴板");
    setTimeout(() => setHasCopied(false), 2000);
  };

  const handleInsertToEditor = () => {
    if (!transcript) return;
    if (onTranscribeText) {
      onTranscribeText(transcript);
      toast.success("已将转写文字插入到正文");
      destroy();
    }
  };

  const handleAppendToMemo = async () => {
    if (!memoId || !transcript) return;
    setIsSavingMemo(true);
    try {
      const memo = await memoStore.getOrFetchMemoById(memoId);
      if (!memo) {
        toast.error("未找到对应 Memo");
        return;
      }
      const separator = memo.content && !memo.content.endsWith("\n") ? "\n\n" : "";
      const newContent = `${memo.content}${separator}${transcript}`;
      await memoStore.updateMemo(
        {
          id: memo.id,
          content: newContent,
        },
        ["content"]
      );
      toast.success("已成功追加并保存至此 Memo");
      destroy();
    } catch (err: any) {
      toast.error(err.message || "更新 Memo 失败");
    } finally {
      setIsSavingMemo(false);
    }
  };

  return (
    <>
      <div className="dialog-header-container w-full max-w-[440px] flex items-center justify-between gap-3 !mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon.Sparkles className="w-5 h-5 text-blue-500 shrink-0" />
          <p className="title-text !mb-0 font-medium text-base text-gray-800 dark:text-gray-200 truncate">语音转文字</p>
          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 dark:bg-blue-950/70 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/60 shrink-0">
            Nova-3
          </span>
        </div>
        <IconButton size="sm" onClick={destroy} className="shrink-0 -mr-1">
          <Icon.X className="w-5 h-auto" />
        </IconButton>
      </div>

      <div className="dialog-content-container w-full max-w-[440px] flex flex-col gap-3 text-xs text-gray-600 dark:text-gray-300">
        <div className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Icon.FileAudio className="w-4 h-4 text-blue-500 shrink-0" />
            <span className="truncate font-medium text-zinc-700 dark:text-zinc-200 text-xs sm:text-sm">{resource.filename}</span>
          </div>
        </div>

        {!initialSetting.deepgramApiKey && !transcript && (
          <div className="flex flex-col gap-1.5 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60">
            <span className="font-semibold text-amber-900 dark:text-amber-200">当前设备未配置 Deepgram API Key</span>
            <p className="text-[11px] text-amber-700 dark:text-amber-300">请输入您的 Deepgram API Key，配置后将自动保存在当前浏览器：</p>
            <Input
              size="sm"
              type="password"
              placeholder="输入 Deepgram API Key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="mt-1"
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-zinc-500 dark:text-zinc-400 shrink-0">识别语言：</span>
          <Select
            size="sm"
            value={language}
            onChange={(_, val) => val && setLanguage(val as STTLanguage)}
            className="flex-1"
            disabled={isTranscribing}
          >
            <Option value="zh">中文 (普通话)</Option>
            <Option value="en">英语 (English)</Option>
            <Option value="auto">自动检测语言 (Auto Detect)</Option>
          </Select>
        </div>

        {errorMsg && (
          <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 text-xs flex items-start gap-1.5">
            <Icon.AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex flex-col">
              <span className="font-medium">转写遇到错误：</span>
              <span>{errorMsg}</span>
            </div>
          </div>
        )}

        {transcript && (
          <div className="flex flex-col gap-1.5 mt-1">
            <div className="flex justify-between items-center text-zinc-500 text-[11px]">
              <span className="font-medium text-zinc-600 dark:text-zinc-400">转写结果：</span>
              <button
                type="button"
                onClick={handleCopy}
                className="hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1 transition-colors px-1 py-0.5 rounded cursor-pointer"
              >
                {hasCopied ? (
                  <>
                    <Icon.Check className="w-3.5 h-3.5 text-green-500" />
                    <span className="text-green-600 dark:text-green-400 font-medium">已复制</span>
                  </>
                ) : (
                  <>
                    <Icon.Copy className="w-3 h-3" />
                    <span>复制文本</span>
                  </>
                )}
              </button>
            </div>
            <Textarea
              minRows={3}
              maxRows={8}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              className="font-sans text-sm leading-relaxed"
            />
          </div>
        )}

        <div className="mt-3 w-full flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <Button size="sm" variant="plain" color="neutral" onClick={destroy} className="shrink-0">
            关闭
          </Button>

          <div className="flex items-center justify-end gap-2 shrink-0">
            {!transcript ? (
              <Button
                size="sm"
                color="primary"
                loading={isTranscribing}
                onClick={handleStartTranscribe}
                startDecorator={<Icon.Sparkles className="w-4 h-4" />}
                className="w-full sm:w-auto whitespace-nowrap"
              >
                {isTranscribing ? "正在识别中..." : "开始转写"}
              </Button>
            ) : (
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                {onTranscribeText && (
                  <Button
                    size="sm"
                    color="primary"
                    onClick={handleInsertToEditor}
                    startDecorator={<Icon.Check className="w-3.5 h-3.5" />}
                    className="whitespace-nowrap flex-1 sm:flex-initial"
                  >
                    插入正文
                  </Button>
                )}
                {memoId && (
                  <Button
                    size="sm"
                    color="success"
                    loading={isSavingMemo}
                    onClick={handleAppendToMemo}
                    startDecorator={<Icon.Check className="w-3.5 h-3.5" />}
                    className="whitespace-nowrap flex-1 sm:flex-initial"
                  >
                    追加到此 Memo
                  </Button>
                )}
                {!onTranscribeText && !memoId && (
                  <Button
                    size="sm"
                    variant="outlined"
                    color="primary"
                    onClick={handleCopy}
                    startDecorator={<Icon.Copy className="w-3.5 h-3.5" />}
                    className="whitespace-nowrap flex-1 sm:flex-initial"
                  >
                    {hasCopied ? "已复制" : "复制文本"}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export const showAudioTranscriptionDialog = (props: { resource: Resource; memoId?: number; onTranscribeText?: (text: string) => void }) => {
  generateDialog(
    {
      className: "audio-transcription-dialog",
      dialogName: "audio-transcription-dialog",
    },
    AudioTranscriptionDialog,
    props
  );
};

export default showAudioTranscriptionDialog;
