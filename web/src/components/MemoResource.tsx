import { Resource } from "@/types/proto/api/v2/resource_service";
import { getResourceUrl } from "@/utils/resource";
import ResourceIcon from "./ResourceIcon";
import VoiceMemoPlayer from "./VoiceMemoPlayer";

interface Props {
  resource: Resource;
  className?: string;
}

const MemoResource: React.FC<Props> = (props: Props) => {
  const { className, resource } = props;
  const resourceUrl = getResourceUrl(resource);

  const handlePreviewBtnClick = () => {
    window.open(resourceUrl);
  };

  const isAudio = resource.type.startsWith("audio") || Boolean(resource.filename.match(/\.(webm|mp4|wav|m4a|ogg|mp3)$/i));

  if (isAudio) {
    return (
      <div className={`w-full max-w-full min-w-0 ${className || ""}`}>
        <VoiceMemoPlayer resource={resource} />
      </div>
    );
  }

  return (
    <div className={`w-auto flex flex-row justify-start items-center text-gray-500 dark:text-gray-400 hover:opacity-80 ${className || ""}`}>
      <ResourceIcon className="!w-4 !h-4 mr-1" resource={resource} />
      <span className="text-sm max-w-[256px] truncate cursor-pointer" onClick={handlePreviewBtnClick}>
        {resource.filename}
      </span>
    </div>
  );
};

export default MemoResource;
