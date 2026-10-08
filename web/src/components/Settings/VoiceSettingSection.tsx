import { Button, Divider, Input, Option, Select, Switch } from "@mui/joy";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import Icon from "@/components/Icon";
import { getVoiceMemoSetting, setVoiceMemoSetting, VoiceMemoSetting } from "@/helpers/stt";

const VoiceSettingSection = () => {
  const [setting, setSetting] = useState<VoiceMemoSetting>(getVoiceMemoSetting);
  const [apiKey, setApiKey] = useState(setting.deepgramApiKey);

  useEffect(() => {
    setApiKey(setting.deepgramApiKey);
  }, [setting.deepgramApiKey]);

  const handleSaveApiKey = () => {
    const updated = setVoiceMemoSetting({ deepgramApiKey: apiKey.trim() });
    setSetting(updated);
    toast.success("Voice memo settings saved");
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

      <div className="w-full flex flex-col gap-1.5 mt-2">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">Deepgram API Key</span>
          <Button size="sm" variant="outlined" color="neutral" onClick={handleSaveApiKey}>
            保存密钥
          </Button>
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
        <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">转写识别语言 (STT Language)</span>
        <Select size="sm" value={setting.sttLanguage} onChange={(_, val) => val && handleLanguageChange(val as any)}>
          <Option value="zh">普通话 (中文 - Nova 2)</Option>
          <Option value="en">English (English - Nova 2)</Option>
          <Option value="auto">自动识别 (Auto)</Option>
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
