import { Button, IconButton } from "@mui/joy";
import copy from "copy-to-clipboard";
import React from "react";
import { toast } from "react-hot-toast";
import { generateDialog } from "./Dialog";
import Icon from "./Icon";

export type MicrophoneErrorReason = "insecure-context" | "permission-denied" | "device-not-found" | "unsupported-browser";

interface Props extends DialogProps {
  reason: MicrophoneErrorReason;
}

const MicrophoneGuideDialog: React.FC<Props> = ({ destroy, reason }: Props) => {
  const currentOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const chromeFlagsUrl = "chrome://flags/#unsafely-treat-insecure-origin-as-treated-as-secure";

  const handleCopy = (text: string, label: string) => {
    copy(text);
    toast.success(`已复制 ${label} 到剪贴板`);
  };

  return (
    <>
      <div className="dialog-header-container !w-96 max-w-full">
        <div className="flex items-center gap-2">
          <Icon.Mic className="w-5 h-5 text-blue-500" />
          <p className="title-text !mb-0 font-medium text-base text-gray-800 dark:text-gray-200">
            {reason === "insecure-context" ? "麦克风需要 HTTPS 支持" : "麦克风访问指引"}
          </p>
        </div>
        <IconButton size="sm" onClick={destroy}>
          <Icon.X className="w-5 h-auto" />
        </IconButton>
      </div>

      <div className="dialog-content-container !w-96 max-w-full flex flex-col gap-3 text-xs text-gray-600 dark:text-gray-300">
        {reason === "insecure-context" && (
          <>
            <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-200 leading-relaxed">
              <strong>浏览器限制：</strong>当前访问为{" "}
              <code className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/60 font-mono">{currentOrigin}</code>
              （HTTP）。浏览器安全规范要求麦克风仅在 <strong>HTTPS</strong> 或 <strong>localhost</strong> 下可用。
            </div>

            <div className="flex flex-col gap-2 mt-1">
              <span className="font-semibold text-gray-800 dark:text-gray-200">解决办法：</span>
              <div className="p-2 rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50/60 dark:bg-zinc-800/50">
                <div className="font-medium text-gray-700 dark:text-gray-300 mb-1">方案 1（推荐）：配置 HTTPS</div>
                <p className="text-gray-500 dark:text-gray-400">使用 Nginx 反代配置 SSL 证书，通过 https:// 访问即可正常录音。</p>
              </div>

              <div className="p-2 rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50/60 dark:bg-zinc-800/50">
                <div className="font-medium text-gray-700 dark:text-gray-300 mb-1">方案 2（内网免证书）：Chrome/Edge 白名单</div>
                <ol className="list-decimal list-inside text-gray-500 dark:text-gray-400 space-y-1">
                  <li>
                    复制网址：
                    <button
                      type="button"
                      onClick={() => handleCopy(currentOrigin, "当前网址")}
                      className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white dark:bg-zinc-700 border border-gray-200 dark:border-zinc-600 text-blue-600 dark:text-blue-400"
                    >
                      <Icon.Copy className="w-3 h-3" />
                      复制 {currentOrigin}
                    </button>
                  </li>
                  <li>
                    打开 Flags：
                    <button
                      type="button"
                      onClick={() => handleCopy(chromeFlagsUrl, "Flags 路径")}
                      className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white dark:bg-zinc-700 border border-gray-200 dark:border-zinc-600 text-gray-700 dark:text-gray-300 font-mono"
                    >
                      <Icon.Copy className="w-3 h-3" />
                      复制 Flags 路径
                    </button>
                  </li>
                  <li>
                    在 <strong>Insecure origins treated as secure</strong> 中粘贴并设为 Enabled。
                  </li>
                  <li>
                    点击 <strong>Relaunch</strong> 重启浏览器生效。
                  </li>
                </ol>
              </div>
            </div>
          </>
        )}

        {reason === "permission-denied" && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 text-red-800 dark:text-red-200 leading-relaxed">
            <p className="font-semibold text-sm mb-1">麦克风权限被拒绝</p>
            <p>请点击浏览器地址栏左侧的 🔒 或 站点权限 按钮，将「麦克风」修改为「允许」，并刷新页面后重试。</p>
          </div>
        )}

        {reason === "device-not-found" && (
          <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800/60 text-orange-800 dark:text-orange-200 leading-relaxed">
            <p className="font-semibold text-sm mb-1">未检测到可用麦克风</p>
            <p>请检查您的电脑或手机是否连接了可用麦克风，并确认系统音频输入设置正常。</p>
          </div>
        )}

        {reason === "unsupported-browser" && (
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-gray-300 leading-relaxed">
            <p className="font-semibold text-sm mb-1">当前浏览器不支持音频录制</p>
            <p>建议使用最新版本的 Chrome、Edge、Firefox 或 Safari 浏览器访问 Memos。</p>
          </div>
        )}

        <div className="mt-2 w-full flex flex-row justify-end items-center">
          <Button size="sm" color="primary" onClick={destroy}>
            我知道了
          </Button>
        </div>
      </div>
    </>
  );
};

export const showMicrophoneGuideDialog = (props: { reason: MicrophoneErrorReason }) => {
  generateDialog(
    {
      className: "microphone-guide-dialog",
      dialogName: "microphone-guide-dialog",
    },
    MicrophoneGuideDialog,
    props
  );
};

export default showMicrophoneGuideDialog;
