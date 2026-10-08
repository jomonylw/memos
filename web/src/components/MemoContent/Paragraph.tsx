import { Node, NodeType } from "@/types/proto/api/v2/markdown_service";
import EmbeddedBookmark from "./EmbeddedBookmark";
import EmbeddedIframe from "./EmbeddedIframe";
import EmbeddedTweet from "./EmbeddedTweet";
import Renderer from "./Renderer";
import { BaseProps } from "./types";
import { isBookmarkUrl } from "./utils/bookmark";
import { extractIframeAttributes, parseVideoUrl } from "./utils/embed";
import { extractTweetFromChildren } from "./utils/tweet";

interface Props extends BaseProps {
  children: Node[];
}

const Paragraph: React.FC<Props> = ({ children }: Props) => {
  const tweetInfo = extractTweetFromChildren(children);
  if (tweetInfo) {
    return <EmbeddedTweet embedInfo={tweetInfo} />;
  }

  const nonWhitespaceChildren = children.filter((child) => {
    if (child.type === NodeType.LINE_BREAK) {
      return false;
    }
    if (child.type === NodeType.TEXT) {
      return (child.textNode?.content || "").trim().length > 0;
    }
    return true;
  });

  if (nonWhitespaceChildren.length === 1) {
    const firstChild = nonWhitespaceChildren[0];

    if (firstChild.type === NodeType.AUTO_LINK || firstChild.type === NodeType.LINK) {
      const url = firstChild.autoLinkNode?.url || firstChild.linkNode?.url || "";
      const text = firstChild.linkNode?.text;
      if (parseVideoUrl(url)) {
        return <EmbeddedIframe url={url} />;
      }
      if (isBookmarkUrl(url)) {
        return <EmbeddedBookmark url={url} text={text} />;
      }
    }

    if (firstChild.type === NodeType.TEXT) {
      const content = (firstChild.textNode?.content || "").trim();
      if (parseVideoUrl(content)) {
        return <EmbeddedIframe url={content} />;
      }

      if (content.startsWith("<iframe") && (content.endsWith("</iframe>") || content.endsWith("/>"))) {
        const attrs = extractIframeAttributes(content);
        if (attrs) {
          return (
            <EmbeddedIframe
              url={attrs.src}
              title={attrs.title}
              width={attrs.width}
              height={attrs.height}
              allow={attrs.allow}
              allowFullScreen={attrs.allowFullScreen}
              referrerPolicy={attrs.referrerPolicy}
            />
          );
        }
      }

      if (isBookmarkUrl(content)) {
        return <EmbeddedBookmark url={content} />;
      }
    }
  }

  return (
    <p>
      {children.map((child, index) => (
        <Renderer key={`${child.type}-${index}`} index={String(index)} node={child} />
      ))}
    </p>
  );
};

export default Paragraph;
