interface Props {
  content: string;
}

const Code: React.FC<Props> = ({ content }: Props) => {
  return (
    <code className="inline break-all px-1.5 py-0.5 mx-0.5 font-mono text-sm rounded bg-gray-100 dark:bg-zinc-700 text-gray-800 dark:text-gray-200">
      {content}
    </code>
  );
};

export default Code;
