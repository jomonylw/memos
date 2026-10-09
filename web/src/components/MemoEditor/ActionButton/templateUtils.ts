import { Memo } from "@/types/proto/api/v2/memo_service";

export interface ParsedTemplate {
  id: number;
  title: string;
  body: string;
  rawContent: string;
}

/**
 * Replace all dynamic date/time variables in template string.
 * Supports:
 * - {{date}}: YYYY-MM-DD
 * - {{time}}: HH:mm
 * - {{datetime}}: YYYY-MM-DD HH:mm
 * - {{weekday}}: 星期五 / Friday
 * - {{weekday_short}}: 周五 / Fri
 * - {{date_cn}}: YYYY年MM月DD日
 * - {{year}}: YYYY
 * - {{month}}: MM
 * - {{day}}: DD
 * - {{date:FORMAT}}: Custom formats, e.g. {{date:YYYY/MM/DD}}, {{date:MM-DD ddd}}
 */
export const formatTemplateString = (template: string, locale: string = "zh"): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();

  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

  const isZh = locale.toLowerCase().startsWith("zh");
  const weekdaysLong = isZh
    ? ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"]
    : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const weekdaysShort = isZh
    ? ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
    : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const weekdayLong = weekdaysLong[now.getDay()];
  const weekdayShort = weekdaysShort[now.getDay()];

  // Replace custom date formats: {{date:FORMAT}}
  let result = template.replace(/\{\{date:([^}]+)\}\}/g, (_, format: string) => {
    return format
      .replace(/YYYY/g, String(year))
      .replace(/YY/g, String(year).slice(-2))
      .replace(/MM/g, pad(month))
      .replace(/M/g, String(month))
      .replace(/DD/g, pad(day))
      .replace(/D/g, String(day))
      .replace(/HH/g, pad(hours))
      .replace(/mm/g, pad(minutes))
      .replace(/ss/g, pad(seconds))
      .replace(/dddd/g, weekdayLong)
      .replace(/ddd/g, weekdayShort);
  });

  const replacements: Record<string, string> = {
    "{{date}}": `${year}-${pad(month)}-${pad(day)}`,
    "{{time}}": `${pad(hours)}:${pad(minutes)}`,
    "{{datetime}}": `${year}-${pad(month)}-${pad(day)} ${pad(hours)}:${pad(minutes)}`,
    "{{weekday}}": weekdayLong,
    "{{weekday_short}}": weekdayShort,
    "{{date_cn}}": `${year}年${pad(month)}月${pad(day)}日`,
    "{{year}}": String(year),
    "{{month}}": pad(month),
    "{{day}}": pad(day),
  };

  for (const [key, val] of Object.entries(replacements)) {
    result = result.split(key).join(val);
  }

  return result;
};

/**
 * Extract template title and effective body from a Memo containing #template or #模板.
 */
export const parseTemplateFromMemo = (memo: Memo): ParsedTemplate | null => {
  if (!memo.content) {
    return null;
  }

  const content = memo.content;
  const templateTagRegex = /(^|\s)#(?:template|模板)(?:\/([^\s]+)|(\s|$))/i;
  if (!templateTagRegex.test(content)) {
    return null;
  }

  const lines = content.split("\n");
  let title = "";
  const bodyLines: string[] = [];

  // 1. Check if tag is in subtag format: #模板/读书笔记 or #template/review
  const subtagMatch = content.match(/#(?:template|模板)\/([^\s]+)/i);
  if (subtagMatch && subtagMatch[1]) {
    title = subtagMatch[1].trim();
  }

  let foundTagHeader = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Line is solely "#模板" or "#模板 模板标题" (where title does NOT start with #)
    const soloHeaderMatch = trimmed.match(/^#(?:template|模板)(?:\s+([^#\n]+))?$/i);
    if (!foundTagHeader && soloHeaderMatch) {
      foundTagHeader = true;
      if (!title && soloHeaderMatch[1]) {
        title = soloHeaderMatch[1].trim();
      }
      // Omit pure template definition line
      continue;
    }

    // Strip ONLY #(template|模板) and subtag #(template|模板)/...
    // ALL other tags (e.g. #打卡, #习惯, #工作) are completely preserved!
    const strippedLine = line
      .replace(/#(?:template|模板)\/[^\s]+/gi, "")
      .replace(/(^|\s)#(?:template|模板)(?=\s|$)/gi, " ")
      .trimEnd();

    // If the line had #template and after stripping is empty, skip this blank header line
    if (trimmed.startsWith("#") && strippedLine.trim() === "" && !foundTagHeader) {
      foundTagHeader = true;
      continue;
    }

    bodyLines.push(strippedLine);
  }

  // 2. If title still not determined, get from first non-empty line of content
  if (!title) {
    for (const line of lines) {
      const clean = line.replace(/#(?:template|模板)[^\s]*/gi, "").trim();
      if (clean) {
        title = clean
          .replace(/^[#\s*-_]+/, "")
          .replace(/\{\{[^}]+\}\}/g, "")
          .trim()
          .slice(0, 30);
        break;
      }
    }
  }

  if (!title) {
    title = `模板 #${memo.id}`;
  }

  return {
    id: memo.id,
    title,
    body: bodyLines.join("\n").trim(),
    rawContent: memo.content,
  };
};

/**
 * Built-in default template for demonstration if user has none yet.
 */
export const DEFAULT_TEMPLATE_PRESET = {
  title: "每日打卡",
  content: `#模板 每日打卡\n#每日打卡 {{date}} {{weekday_short}}\n- [ ] 🏃 晨练 30 分钟\n- [ ] 💧 饮水 2000ml\n- [ ] 📖 深度阅读 30 分钟\n- [ ] 🌙 今日复盘收获：`,
};

export interface TemplateVariableInfo {
  token: string;
  label: string;
  example: string;
}

export const TEMPLATE_VARIABLES: TemplateVariableInfo[] = [
  { token: "{{date}}", label: "今日日期", example: "2026-10-09" },
  { token: "{{time}}", label: "当前时间", example: "14:30" },
  { token: "{{weekday}}", label: "星期", example: "星期五" },
  { token: "{{weekday_short}}", label: "星期简写", example: "周五" },
  { token: "{{datetime}}", label: "完整时间", example: "2026-10-09 14:30" },
  { token: "{{date_cn}}", label: "中文日期", example: "2026年10月09日" },
];

export const APPLY_TEMPLATE_EVENT = "memos:apply-template";

export const dispatchApplyTemplate = (template: ParsedTemplate) => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(APPLY_TEMPLATE_EVENT, {
        detail: { template },
      })
    );
  }
};

export const subscribeApplyTemplate = (callback: (template: ParsedTemplate) => void) => {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<{ template: ParsedTemplate }>;
    if (customEvent.detail?.template) {
      callback(customEvent.detail.template);
    }
  };
  window.addEventListener(APPLY_TEMPLATE_EVENT, handler);
  return () => {
    window.removeEventListener(APPLY_TEMPLATE_EVENT, handler);
  };
};


