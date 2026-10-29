import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';
import { cx } from './ui';

/** Markdown with programme-styled code blocks. Headings inside content start at h3. */
export function Markdown({ children, compact, className }: { children: string; compact?: boolean; className?: string }) {
  return (
    <div className={cx('prose-ae', compact && 'prose-compact', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h3>{children}</h3>,
          h2: ({ children }) => <h3>{children}</h3>,
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, node }) => {
            const text = String(children ?? '');
            const meta = (node?.data as { meta?: string } | undefined)?.meta ?? (node as unknown as { meta?: string })?.meta ?? '';
            const isBlock = /language-/.test(className ?? '') || text.includes('\n');
            if (!isBlock) return <code>{children}</code>;
            const lang = (className ?? '').replace('language-', '');
            return <CodeBlock code={text} info={`${lang} ${meta}`.trim()} />;
          },
          a: ({ href, children }) => (
            <a href={href} target={href?.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
