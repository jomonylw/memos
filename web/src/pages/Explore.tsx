import { useEffect, useState } from "react";
import InfiniteScrollTrigger from "@/components/InfiniteScrollTrigger";
import MemoFilter from "@/components/MemoFilter";
import MemoView from "@/components/MemoView";
import MobileHeader from "@/components/MobileHeader";
import { DEFAULT_MEMO_LIMIT } from "@/helpers/consts";
import { getTimeStampByDate } from "@/helpers/datetime";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useFilterStore } from "@/store/module";
import { useMemoList, useMemoStore } from "@/store/v1";

const Explore = () => {
  const user = useCurrentUser();
  const filterStore = useFilterStore();
  const memoStore = useMemoStore();
  const memoList = useMemoList();
  const [isRequesting, setIsRequesting] = useState(true);
  const [isComplete, setIsComplete] = useState(false);
  const { tag: tagQuery, text: textQuery } = filterStore.state;
  const sortedMemos = memoList.value.sort((a, b) => getTimeStampByDate(b.displayTime) - getTimeStampByDate(a.displayTime));

  useEffect(() => {
    memoList.reset();
    fetchMemos();
  }, [tagQuery, textQuery]);

  const fetchMemos = async () => {
    const filters = [`row_status == "NORMAL"`, `visibilities == [${user ? "'PUBLIC', 'PROTECTED'" : "'PUBLIC'"}]`];
    const contentSearch: string[] = [];
    if (tagQuery) {
      contentSearch.push(`"#${tagQuery}"`);
    }
    if (textQuery) {
      contentSearch.push(`"${textQuery}"`);
    }
    if (contentSearch.length > 0) {
      filters.push(`content_search == [${contentSearch.join(", ")}]`);
    }
    setIsRequesting(true);
    try {
      const data = await memoStore.fetchMemos({
        filter: filters.join(" && "),
        limit: DEFAULT_MEMO_LIMIT,
        offset: memoList.size(),
      });
      setIsComplete(data.length < DEFAULT_MEMO_LIMIT);
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <section className="@container w-full max-w-5xl min-h-full flex flex-col justify-start items-center sm:pt-3 md:pt-6 pb-8">
      <MobileHeader />
      <div className="relative w-full h-auto flex flex-col justify-start items-start px-4 sm:px-6">
        <MemoFilter className="px-2 pb-2" />
        {sortedMemos.map((memo) => (
          <MemoView key={memo.id} memo={memo} showCreator />
        ))}
        <InfiniteScrollTrigger
          isRequesting={isRequesting}
          isComplete={isComplete}
          onLoadMore={fetchMemos}
          isEmpty={sortedMemos.length === 0}
        />
      </div>
    </section>
  );
};

export default Explore;
