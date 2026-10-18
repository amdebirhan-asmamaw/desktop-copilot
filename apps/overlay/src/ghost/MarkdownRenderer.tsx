import React from 'react';

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const lines = content.split('\n');

  const renderInline = (text: string): React.ReactNode => {
    // Match inline code `code`
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);

    return parts.map((part, idx) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code
            key={idx}
            className="px-1.5 py-0.5 mx-0.5 rounded bg-slate-800 text-sky-300 font-mono text-[13px] border border-slate-700/60"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={idx} className="font-semibold text-white tracking-wide">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return part;
    });
  };

  let inCodeBlock = false;
  let codeBuffer: string[] = [];

  const renderedElements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        // Closing code block
        inCodeBlock = false;
        renderedElements.push(
          <pre
            key={`code_${i}`}
            className="p-3 my-2 rounded-lg bg-slate-950/90 border border-slate-800 text-emerald-400 font-mono text-[13px] overflow-x-auto shadow-inner"
          >
            <code>{codeBuffer.join('\n')}</code>
          </pre>
        );
        codeBuffer = [];
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    if (line.startsWith('### ')) {
      renderedElements.push(
        <h3 key={`h3_${i}`} className="text-sm font-bold text-sky-400 uppercase tracking-wider mt-3 mb-1.5">
          {line.replace('### ', '')}
        </h3>
      );
    } else if (line.startsWith('## ')) {
      renderedElements.push(
        <h2 key={`h2_${i}`} className="text-base font-bold text-white mt-3.5 mb-1.5">
          {line.replace('## ', '')}
        </h2>
      );
    } else if (line.trim().startsWith('•') || line.trim().startsWith('-')) {
      const bulletContent = line.trim().replace(/^[•-]\s*/, '');
      renderedElements.push(
        <div key={`bullet_${i}`} className="flex items-start gap-2 my-1 text-slate-100 pl-1">
          <span className="text-sky-400 text-base leading-none select-none">•</span>
          <div className="flex-1 leading-relaxed">{renderInline(bulletContent)}</div>
        </div>
      );
    } else if (line.trim() === '') {
      renderedElements.push(<div key={`sp_${i}`} className="h-1.5" />);
    } else {
      renderedElements.push(
        <p key={`p_${i}`} className="my-1 leading-relaxed text-slate-100">
          {renderInline(line)}
        </p>
      );
    }
  }

  if (inCodeBlock && codeBuffer.length > 0) {
    renderedElements.push(
      <pre
        key="code_unclosed"
        className="p-3 my-2 rounded-lg bg-slate-950/90 border border-slate-800 text-emerald-400 font-mono text-[13px] overflow-x-auto"
      >
        <code>{codeBuffer.join('\n')}</code>
      </pre>
    );
  }

  return <div className="space-y-0.5">{renderedElements}</div>;
};
