import { Button } from "@mui/joy";
import classNames from "classnames";
import React from "react";
import Empty from "@/components/Empty";
import Icon from "@/components/Icon";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useTranslate } from "@/utils/i18n";

interface Props {
  isRequesting: boolean;
  isComplete: boolean;
  onLoadMore: () => void | Promise<void>;
  isEmpty?: boolean;
  className?: string;
}

const InfiniteScrollTrigger: React.FC<Props> = ({ isRequesting, isComplete, onLoadMore, isEmpty, className }: Props) => {
  const t = useTranslate();
  const sentinelRef = useInfiniteScroll({
    onLoadMore,
    hasMore: !isComplete,
    isLoading: isRequesting,
  });

  if (isEmpty && isComplete) {
    return (
      <div className={classNames("w-full mt-12 mb-8 flex flex-col justify-center items-center italic", className)}>
        <Empty />
        <p className="mt-2 text-gray-600 dark:text-gray-400">{t("message.no-data")}</p>
      </div>
    );
  }

  return (
    <div ref={sentinelRef} className={classNames("w-full flex flex-col justify-center items-center", className)}>
      {isRequesting ? (
        <div className="flex flex-row justify-center items-center gap-2 w-full my-6 text-sm text-gray-400 dark:text-gray-500 italic">
          <Icon.Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
          <span>{t("memo.fetching-data")}</span>
        </div>
      ) : isComplete ? (
        <div className="w-full flex justify-center items-center my-6 text-xs text-gray-300 dark:text-gray-600 select-none">
          <div className="h-px bg-gray-200 dark:bg-zinc-800 w-12 mr-3" />
          <span>{t("message.memos-ready")}</span>
          <div className="h-px bg-gray-200 dark:bg-zinc-800 w-12 ml-3" />
        </div>
      ) : (
        <div className="w-full flex flex-row justify-center items-center my-4">
          <Button
            variant="plain"
            size="sm"
            color="neutral"
            endDecorator={<Icon.ArrowDown className="w-5 h-auto opacity-60" />}
            onClick={onLoadMore}
            className="!text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          >
            {t("memo.fetch-more")}
          </Button>
        </div>
      )}
    </div>
  );
};

export default InfiniteScrollTrigger;
