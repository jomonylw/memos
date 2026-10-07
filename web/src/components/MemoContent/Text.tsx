import EmbeddedIframe from "./EmbeddedIframe";
import { splitTextWithIframe } from "./utils/embed";

interface Props {
  content: string;
}

const Text: React.FC<Props> = ({ content }: Props) => {
  if (!content || !content.includes("<iframe")) {
    return <span>{content}</span>;
  }

  const segments = splitTextWithIframe(content);
  return (
    <>
      {segments.map((seg, idx) => {
        if (seg.type === "iframe") {
          return (
            <EmbeddedIframe
              key={idx}
              url={seg.attributes.src}
              title={seg.attributes.title}
              width={seg.attributes.width}
              height={seg.attributes.height}
              allow={seg.attributes.allow}
              allowFullScreen={seg.attributes.allowFullScreen}
              referrerPolicy={seg.attributes.referrerPolicy}
            />
          );
        }
        return <span key={idx}>{seg.content}</span>;
      })}
    </>
  );
};

export default Text;
