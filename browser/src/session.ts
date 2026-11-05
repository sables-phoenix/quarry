import { Effect } from "effect";
import { Browser, BrowserError } from "./browser.js";
import { Graph } from "./graph.js";
import { buildState, diffStates, projectState, tokenCount } from "./state.js";
import type { Assertion, AxNode, Delta, Flow, Projection, State, Step } from "./types.js";

export type ActResult = {
  ok: boolean;
  failed?: Step;
  ms: number;
  delta: Delta;
  state: State;
};

export type ReplayResult = {
  ok: boolean;
  failed?: Step;
  assertions: Array<{ op: string; value: unknown; ok: boolean }>;
  witness: string;
  tokens: number;
  state: State;
};

export type JumpResult = {
  reached: boolean;
  actions: number;
  ms: number;
  model_tokens: number;
  state: State;
};

export type Look = {
  kind: "crop" | "full";
  tokens: number;
  changed: number;
  ratio: number;
  box: { x: number; y: number; width: number; height: number } | null;
  data: string;
};

export class Session {
  readonly browser: Browser;
  readonly graph: Graph;
  state: State | null;
  private lastShot: string | null = null;

  private constructor(browser: Browser, graph: Graph, state: State | null) {
    this.browser = browser;
    this.graph = graph;
    this.state = state;
  }

  static create(): Effect.Effect<Session, BrowserError> {
    return Browser.launch().pipe(Effect.map((browser) => new Session(browser, new Graph(), null)));
  }

  private capture(): Effect.Effect<State, BrowserError> {
    const self = this;
    return Effect.gen(function* () {
      const ax = yield* self.browser.ax();
      const current = yield* self.browser.url();
      const visible = String(yield* self.browser.evalJs("document.body.innerText")).replace(/\s+/g, " ");
      return buildState(ax as AxNode[], current, { visibleText: visible });
    });
  }

  open(url: string): Effect.Effect<State, BrowserError> {
    const self = this;
    return Effect.gen(function* () {
      yield* self.browser.navigate(url);
      self.lastShot = null;
      const state = yield* self.capture();
      self.state = state;
      yield* Effect.sync(() => self.graph.rememberState(state));
      return state;
    });
  }

  act(steps: Step[]): Effect.Effect<ActResult, BrowserError> {
    const self = this;
    return Effect.gen(function* () {
      if (!self.state) return yield* Effect.fail(new BrowserError({ message: "open a page first" }));
      const before = self.state;
      const result = yield* self.browser.act(steps);
      const after = yield* self.capture();
      const delta = diffStates(before, after);
      self.state = after;
      yield* Effect.sync(() => {
        self.graph.rememberState(after);
        if (result.ok) self.graph.record(before.hash, steps, after.hash);
      });
      return { ok: result.ok, failed: result.failed, ms: result.ms, delta, state: after };
    });
  }

  replay(flow: Flow): Effect.Effect<ReplayResult, BrowserError> {
    const self = this;
    return Effect.gen(function* () {
      yield* self.browser.navigate(flow.url);
      const before = yield* self.capture();
      const run = yield* self.browser.act(flow.steps);
      const after = yield* self.capture();
      const assertions = yield* self.browser.assert(flow.asserts ?? []);
      const ok = run.ok && assertions.every((assertion) => assertion.ok);
      const witness = ok ? "" : diffStates(before, after).text;
      self.state = after;
      return { ok, failed: run.failed, assertions, witness, tokens: tokenCount(ok ? "pass" : `fail\n${witness}`), state: after };
    });
  }

  jump(target: string): Effect.Effect<JumpResult, BrowserError> {
    const self = this;
    return Effect.gen(function* () {
      if (!self.state) return yield* Effect.fail(new BrowserError({ message: "open a page first" }));
      const paths = self.graph.path(self.state.hash, target);
      if (!paths) return yield* Effect.fail(new BrowserError({ message: `no known path to ${target}` }));
      const steps = paths.flat();
      const result = yield* self.act(steps);
      return { reached: self.state.hash === target, actions: steps.length, ms: result.ms, model_tokens: 0, state: self.state };
    });
  }

  fingerprint(): Effect.Effect<{ text: string; tokens: number; hash: string }, BrowserError> {
    const self = this;
    return Effect.gen(function* () {
      const state = yield* self.capture();
      self.state = state;
      const title = String(yield* self.browser.evalJs("document.title"));
      const controls = state.nodes.filter((node) => ["link", "button", "textbox", "tab", "checkbox", "radio", "combobox", "switch"].includes(node.role)).length;
      const text = JSON.stringify({ hash: state.hash, url: state.url, title, text_chars: state.chars, controls, nodes: state.nodes.length });
      return { text, tokens: tokenCount(text), hash: state.hash };
    });
  }

  fillForm(values: string[]): Effect.Effect<{ filled: number; fields: string[] }, BrowserError> {
    const self = this;
    return Effect.gen(function* () {
      const result = yield* self.browser.fillForm(values);
      self.state = yield* self.capture();
      return result;
    });
  }

  controls(): Effect.Effect<{ text: string; tokens: number }, BrowserError> {
    const self = this;
    return Effect.gen(function* () {
      const state = yield* self.capture();
      self.state = state;
      const roles = new Set(["link", "button", "textbox", "tab", "checkbox", "radio", "combobox", "switch", "searchbox"]);
      const text = state.nodes
        .filter((node) => roles.has(node.role))
        .map((node) => `${node.id} ${node.role} ${node.name}${node.value ? ` = ${node.value}` : ""}`)
        .join("\n");
      return { text, tokens: tokenCount(text) };
    });
  }

  look(): Effect.Effect<Look, BrowserError> {
    const self = this;
    return Effect.gen(function* () {
      const after = yield* self.browser.screenshot();
      if (!self.lastShot) {
        self.lastShot = after;
        return { kind: "full", tokens: 1366, changed: -1, ratio: 1, box: null, data: after };
      }
      const diff = yield* self.browser.imageDiff(self.lastShot, after);
      self.lastShot = after;
      if (diff.changed > 0 && diff.ratio < 0.35 && diff.box) {
        const crop = yield* self.browser.screenshot(diff.box);
        const tokens = Math.ceil((diff.box.width * diff.box.height) / 750);
        return { kind: "crop", tokens, changed: diff.changed, ratio: diff.ratio, box: diff.box, data: crop };
      }
      return { kind: "full", tokens: 1366, changed: diff.changed, ratio: diff.ratio, box: diff.box, data: after };
    });
  }

  project(query: string): Effect.Effect<Projection | null, BrowserError> {
    const self = this;
    return Effect.sync(() => (self.state ? projectState(self.state, query) : null));
  }

  close(): Effect.Effect<void> {
    return this.browser.close();
  }
}
