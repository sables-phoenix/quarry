export type AxNode = {
  nodeId: string;
  parentId?: string | null;
  childIds?: string[];
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: unknown };
  value?: { value?: unknown };
  properties?: Array<{ name?: string; value?: { value?: unknown } }>;
};

export type StateNode = {
  id: string;
  role: string;
  name: string;
  value: string;
};

export type State = {
  hash: string;
  url: string;
  nodes: StateNode[];
  text: string;
  chars: number;
  tokens: number;
  map: Map<string, StateNode>;
};

export type Delta = {
  added: number;
  removed: number;
  changed: number;
  text: string;
  chars: number;
  tokens: number;
  empty: boolean;
};

export type Projection = {
  nodes: StateNode[];
  text: string;
  chars: number;
  tokens: number;
  matched: number;
};

export type Step =
  | { op: "click"; role: string; name: string }
  | { op: "fill"; role: string; name: string; value: string }
  | { op: "select"; name: string; value: string }
  | { op: "check"; name: string; value: boolean }
  | { op: "wait"; ms?: number };

export type Assertion =
  | { op: "text"; value: string }
  | { op: "not_text"; value: string }
  | { op: "count"; selector: string; value: number }
  | { op: "url"; value: string };

export type Flow = { url: string; steps: Step[]; asserts?: Assertion[] };
