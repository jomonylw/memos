import { Resource } from "@/types/proto/api/v2/resource_service";
import showAudioTranscriptionDialog from "../AudioTranscriptionDialog";
import Icon from "../Icon";
import ResourceIcon from "../ResourceIcon";

interface Props {
  resourceList: Resource[];
  setResourceList: (resourceList: Resource[]) => void;
  onTranscribeText?: (text: string) => void;
}

const ResourceListView = (props: Props) => {
  const { resourceList, setResourceList, onTranscribeText } = props;

  const handleDeleteResource = async (resourceId: ResourceId) => {
    setResourceList(resourceList.filter((resource) => resource.id !== resourceId));
  };

  return (
    <>
      {resourceList.length > 0 && (
        <div className="w-full flex flex-row justify-start flex-wrap gap-2 mt-2">
          {resourceList.map((resource) => {
            const isAudio = resource.type.startsWith("audio") || Boolean(resource.filename.match(/\.(webm|mp4|wav|m4a|ogg|mp3)$/i));
            return (
              <div
                key={resource.id}
                className="max-w-full flex flex-row justify-start items-center flex-nowrap gap-x-1.5 bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 rounded-lg text-gray-600 dark:text-gray-300 border border-zinc-200/60 dark:border-zinc-700/60"
              >
                <ResourceIcon resource={resource} className="!w-4 !h-4 !opacity-100" />
                <span className="text-xs sm:text-sm max-w-[7rem] sm:max-w-[10rem] truncate font-medium min-w-0">{resource.filename}</span>
                {isAudio && (
                  <button
                    type="button"
                    onClick={() => showAudioTranscriptionDialog({ resource, onTranscribeText })}
                    className="flex items-center gap-0.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 rounded transition-colors ml-0.5 whitespace-nowrap shrink-0"
                    title="手动语音转写"
                  >
                    <Icon.Sparkles className="w-3 h-3 shrink-0" />
                    <span className="whitespace-nowrap">转写</span>
                  </button>
                )}
                <Icon.X
                  className="w-4 h-auto cursor-pointer opacity-60 hover:opacity-100 hover:text-red-500 transition-colors ml-0.5 shrink-0"
                  onClick={() => handleDeleteResource(resource.id)}
                />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};

export default ResourceListView;
