import { Button, Divider, Input, Option, Select, Switch } from "@mui/joy";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import Icon from "@/components/Icon";
import showMicrophoneGuideDialog from "@/components/MicrophoneGuideDialog";
import { checkMicrophoneSupport, getVoiceMemoSetting, setVoiceMemoSetting, verifyDeepgramApiKey, VoiceMemoSetting } from "@/helpers/stt";

const VoiceSettingSection = () => {
  const [setting, setSetting] = useState<VoiceMemoSetting>(getVoiceMemoSetting);
  const [apiKey, setApiKey] = useState(setting.deepgramApiKey);
  const [isVerifying, setIsVerifying] = useState(false);
  const [micStatus, setMicStatus] = useState<ReturnType<typeof checkMicrophoneSupport>>({
    supported: false,
    isSecure: false,
  });

  useEffect(() => {
    setApiKey(setting.deepgramApiKey);
  }, [setting.deepgramApiKey]);

  useEffect(() => {
    setMicStatus(checkMicrophoneSupport());
  }, []);

  const handleSaveApiKey = () => {
    const updated = setVoiceMemoSetting({ deepgramApiKey: apiKey.trim() });
    setSetting(updated);
    toast.success("Voice memo settings saved");
  };

  const handleVerifyApiKey = async () => {
    if (!apiKey.trim()) {
      toast.error("请先输入 API Key");
      return;
    }
    setIsVerifying(true);
    try {
      const result = await verifyDeepgramApiKey(apiKey.trim());
      if (result.success) {
        toast.success(result.message);
        const updated = setVoiceMemoSetting({ deepgramApiKey: apiKey.trim() });
        setSetting(updated);
      } else {
        toast.error(result.message);
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const handleModelChange = (model: "nova-3" | "nova-2") => {
    const updated = setVoiceMemoSetting({ sttModel: model });
    setSetting(updated);
  };

  const handleLanguageChange = (lang: "zh" | "en" | "auto") => {
    const updated = setVoiceMemoSetting({ sttLanguage: lang });
    setSetting(updated);
  };

  const handleAutoAppendToggle = (enabled: boolean) => {
    const updated = setVoiceMemoSetting({ autoAppendToEditor: enabled });
    setSetting(updated);
  };

  return (
    <div className="w-full flex flex-col gap-3 pt-2 pb-4">
      <div className="flex items-center gap-2">
        <Icon.Mic className="w-5 h-5 text-blue-500" />
        <span className="font-medium text-gray-700 dark:text-gray-300">语音速记 & Deepgram STT</span>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        配置 Deepgram API 密钥以开启毫秒级语音转文字。录音将自动上传为资源附件，并可通过现代声波播放器回放。
      </p>

      {/* 麦克风运行环境状态提醒 */}
      <div
        className={`w-full p-2.5 rounded-lg border text-xs flex items-center justify-between ${
          micStatus.supported
            ? "bg-green-50/60 dark:bg-green-950/30 border-green-200 dark:border-green-800/60 text-green-700 dark:text-green-300"
            : "bg-amber-50/60 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-200"
        }`}
      >
        <div className="flex items-center gap-2">
          {micStatus.supported ? (
            <Icon.Check className="w-4 h-4 text-green-600" />
          ) : (
            <Icon.AlertCircle className="w-4 h-4 text-amber-600" />
          )}
          <span>
            {micStatus.supported
              ? "当前运行环境满足麦克风安全要求 (Secure Context)"
              : micStatus.reason === "insecure-context"
              ? "当前环境为非安全 HTTP，麦克风 API 受浏览器策略限制"
              : "当前浏览器不支持麦克风录音"}
          </span>
        </div>
        {!micStatus.supported && (
          <Button
            size="sm"
            variant="plain"
            color="warning"
            onClick={() => showMicrophoneGuideDialog({ reason: micStatus.reason || "unsupported-browser" })}
          >
            查看解决办法
          </Button>
        )}
      </div>

      <div className="w-full flex flex-col gap-1.5 mt-1">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">Deepgram API Key</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="plain" color="primary" loading={isVerifying} onClick={handleVerifyApiKey}>
              测试连接
            </Button>
            <Button size="sm" variant="outlined" color="neutral" onClick={handleSaveApiKey}>
              保存密钥
            </Button>
          </div>
        </div>
        <Input
          type="password"
          className="w-full font-mono text-sm"
          placeholder="Token xxxxxxxxxxxxxxxxxxxxxxxx"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <span className="text-[11px] text-gray-400">密钥保存在本地浏览器中，绝不上传至第三方服务器。</span>
      </div>

      <div className="w-full flex flex-row justify-between items-center mt-2">
        <div>
          <span className="text-sm text-gray-600 dark:text-gray-400 font-medium block">STT 识别模型 (Model)</span>
          <span className="text-[11px] text-gray-400">最新 Nova-3 具备更高准确率与中英多语言自然打断</span>
        </div>
        <Select size="sm" value={setting.sttModel || "nova-3"} onChange={(_, val) => val && handleModelChange(val as any)}>
          <Option value="nova-3">Nova-3 (推荐 / 最新新一代)</Option>
          <Option value="nova-2">Nova-2 (前代通用模型)</Option>
        </Select>
      </div>

      <div className="w-full flex flex-row justify-between items-center mt-2">
        <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">转写识别语言 (STT Language)</span>
        <Select size="sm" value={setting.sttLanguage} onChange={(_, val) => val && handleLanguageChange(val as any)}>
          <Option value="zh">普通话 (中文 / Chinese)</Option>
          <Option value="en">English (英文)</Option>
          <Option value="auto">自动识别 (Auto Language)</Option>
        </Select>
      </div>

      <div className="w-full flex flex-row justify-between items-center mt-2">
        <div>
          <span className="text-sm text-gray-600 dark:text-gray-400 font-medium block">转写完成后自动插入编辑器</span>
          <span className="text-[11px] text-gray-400">关闭后仅保留录音附件，不自动打字到文本区</span>
        </div>
        <Switch checked={setting.autoAppendToEditor} onChange={(e) => handleAutoAppendToggle(e.target.checked)} />
      </div>

      <Divider className="!my-2" />
    </div>
  );
};

export default VoiceSettingSection;
