import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

type Props = {
  source: string;
};

// Renders Markdown with KaTeX-flavored math (`$...$` inline, `$$...$$` block).
// Stays simple — no GFM tables / autolinks etc. unless we add the relevant
// remark plugins.
export function MarkdownView({ source }: Props) {
  if (!source.trim()) {
    return <div className="markdown markdown--empty">(empty)</div>;
  }
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
