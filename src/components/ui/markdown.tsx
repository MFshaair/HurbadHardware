import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { cn } from '@/lib/utils';

/** GitHub schema minus raw HTML and minus anything that can navigate or execute (11 §3). */
const schema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (t) => !['img', 'input', 'script', 'style', 'iframe'].includes(t),
  ),
  attributes: {
    ...defaultSchema.attributes,
    a: [['href'], ['title']],
  },
  protocols: { ...defaultSchema.protocols, href: ['http', 'https', 'mailto'] },
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('prose prose-sm dark:prose-invert max-w-none', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={{
          a: ({ href, children: kids }) => (
            <a href={href} rel="nofollow noopener noreferrer" target="_blank">
              {kids}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
