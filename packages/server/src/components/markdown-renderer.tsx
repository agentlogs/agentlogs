import { File } from "@pierre/diffs/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Component, type ReactNode } from "react";

interface Props {
  children: string;
  className?: string;
}

// Error boundary to catch File component rendering errors
class CodeBlockErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// Map common language aliases to file extensions for syntax detection
function getFileExtension(language: string | undefined): string {
  if (!language) return "txt";

  const langMap: Record<string, string> = {
    javascript: "js",
    typescript: "ts",
    python: "py",
    ruby: "rb",
    rust: "rs",
    golang: "go",
    go: "go",
    bash: "sh",
    shell: "sh",
    sh: "sh",
    zsh: "sh",
    fish: "sh",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    xml: "xml",
    html: "html",
    css: "css",
    scss: "scss",
    sass: "sass",
    less: "less",
    markdown: "md",
    md: "md",
    sql: "sql",
    graphql: "graphql",
    gql: "graphql",
    dockerfile: "dockerfile",
    docker: "dockerfile",
    makefile: "makefile",
    make: "makefile",
    c: "c",
    cpp: "cpp",
    "c++": "cpp",
    csharp: "cs",
    "c#": "cs",
    java: "java",
    kotlin: "kt",
    swift: "swift",
    objc: "m",
    "objective-c": "m",
    php: "php",
    perl: "pl",
    lua: "lua",
    r: "r",
    scala: "scala",
    clojure: "clj",
    elixir: "ex",
    erlang: "erl",
    haskell: "hs",
    ocaml: "ml",
    fsharp: "fs",
    "f#": "fs",
    vim: "vim",
    viml: "vim",
    tsx: "tsx",
    jsx: "jsx",
    vue: "vue",
    svelte: "svelte",
    astro: "astro",
    diff: "diff",
    patch: "diff",
    ini: "ini",
    conf: "conf",
    nginx: "nginx",
    apache: "apache",
    prisma: "prisma",
    proto: "proto",
    protobuf: "proto",
    terraform: "tf",
    hcl: "hcl",
    nix: "nix",
    zig: "zig",
  };

  return langMap[language.toLowerCase()] || language;
}

// Custom code renderer - handles both inline and block code
function CodeRenderer({ className, children }: { className?: string; children?: ReactNode }) {
  const code = String(children).replace(/\n$/, "");

  // Check if this is inline code (single line, no language class typically)
  // react-markdown wraps code blocks in <pre>, inline code is just <code>
  // We detect inline by checking if there's no language class and it's a single line
  const isInline = !className && !code.includes("\n");

  if (isInline) {
    return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.875em]">{children}</code>;
  }

  // Extract language from className (e.g., "language-typescript")
  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : undefined;

  // Use @pierre/diffs File component for syntax highlighting
  const extension = getFileExtension(language);
  const fileName = `code.${extension}`;

  return (
    <div className="my-4 overflow-hidden rounded-lg border border-border">
      <CodeBlockErrorBoundary
        fallback={
          <pre className="overflow-x-auto bg-zinc-900 p-4 font-mono text-sm">
            <code>{code}</code>
          </pre>
        }
      >
        <File
          file={{
            name: fileName,
            contents: code,
          }}
          options={{
            theme: "vitesse-dark",
            overflow: "scroll",
            disableFileHeader: true,
            unsafeCSS:
              ":host, [data-diffs], [data-line], [data-column-number] { --diffs-bg: transparent; } [data-column-number] { border-right: none !important; } pre { background: transparent !important; }",
          }}
        />
      </CodeBlockErrorBoundary>
    </div>
  );
}

// Custom pre renderer - just passes through children since CodeRenderer handles the block
function PreRenderer({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

// Custom link renderer - adds security attributes for external links
function LinkRenderer({ href, children }: { href?: string; children?: ReactNode }) {
  const isExternal = href && (href.startsWith("http://") || href.startsWith("https://"));

  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }

  return <a href={href}>{children}</a>;
}

export function MarkdownRenderer({ children, className }: Props) {
  return (
    <div className={className}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: CodeRenderer,
          pre: PreRenderer,
          a: LinkRenderer,
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
