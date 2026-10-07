import Icon from "@/components/Icon";
import { parseVideoUrl } from "./utils/embed";
import { parseTweetUrl } from "./utils/tweet";

interface Props {
  url: string;
  text?: string;
}

const Link: React.FC<Props> = ({ text, url }: Props) => {
  const videoInfo = parseVideoUrl(url);
  const tweetInfo = parseTweetUrl(url);

  return (
    <a
      className="text-blue-600 dark:text-blue-400 cursor-pointer underline break-all hover:opacity-80 decoration-1 inline-flex items-center gap-0.5"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {videoInfo && <Icon.Play className="w-3.5 h-3.5 inline shrink-0 fill-current opacity-70" />}
      {tweetInfo && <Icon.Twitter className="w-3.5 h-3.5 inline shrink-0 fill-current opacity-70" />}
      <span>{text || url}</span>
    </a>
  );
};

export default Link;
