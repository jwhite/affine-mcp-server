export type MarkdownListStyle = "bulleted" | "numbered" | "todo";

export type TextDelta = {
  insert: string;
  attributes?: {
    bold?: boolean;
    italic?: boolean;
    strike?: boolean;
    code?: boolean;
    link?: string;
  };
};

export type MarkdownOperation =
  | {
      type: "heading";
      text: string;
      level: 1 | 2 | 3 | 4 | 5 | 6;
      deltas?: TextDelta[];
    }
  | {
      type: "paragraph";
      text: string;
      deltas?: TextDelta[];
    }
  | {
      type: "quote";
      text: string;
      deltas?: TextDelta[];
    }
  | {
      type: "callout";
      text: string;
      deltas?: TextDelta[];
    }
  | {
      type: "list";
      text: string;
      style: MarkdownListStyle;
      checked?: boolean;
      deltas?: TextDelta[];
    }
  | {
      type: "code";
      text: string;
      language?: string;
    }
  | {
      type: "divider";
    }
  | {
      type: "table";
      rows: number;
      columns: number;
      tableData: string[][];
      tableCellDeltas?: TextDelta[][][];
    }
  | {
      type: "bookmark";
      url: string;
      caption?: string;
    }
  | {
      type: "image";
      url: string;          // http(s)://, data:, or affine://blob/<sourceId>
      alt?: string;
      // Populated once the image is resolved to a workspace blob (via
      // autoUploadImages or an already-resolved affine://blob/ URL).  When
      // present, the operation becomes a real image block; otherwise the
      // applier falls back to a bookmark.
      sourceId?: string;
      mimeType?: string;
      size?: number;
    };

export type MarkdownParseResult = {
  operations: MarkdownOperation[];
  warnings: string[];
  lossy: boolean;
  stats: {
    inputChars: number;
    blockCount: number;
    unsupportedCount: number;
  };
};

export type MarkdownRenderableBlock = {
  id: string;
  parentId: string | null;
  flavour: string | null;
  type: string | null;
  text: string | null;
  checked: boolean | null;
  language: string | null;
  childIds: string[];
  url: string | null;
  sourceId: string | null;
  caption: string | null;
  tableData: string[][] | null;
};

export type MarkdownRenderResult = {
  markdown: string;
  warnings: string[];
  lossy: boolean;
  stats: {
    blockCount: number;
    unsupportedCount: number;
  };
};
