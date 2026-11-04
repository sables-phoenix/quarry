import { Effect } from "effect";
import { Browser, BrowserError } from "./browser.js";
import { Graph } from "./graph.js";
import { buildState, diffStates, projectState } from "./state.js";
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

export class Session {
  readonly browser: Browser;
  readonly graph: Graph;
  state: State | null;

  private constructor(browser: Browser, graph: Graph, state: State | null) {
    this.browser = browser;
    this.graph = graph;
    this.state = state;
  }

  static create(): Effect.Effect<Session, BrowserError> {
    return Browser.launch().pipe(Effect.map((browser) => new Session(browser, new Graph(), null)));
  }

  open(url: string): Effect.Effect<State, BrowserError> {
    const self = this;
    return Effect.gen(function* () {
      yield* self.browser.navigate(url);
      const ax = yield* self.browser.ax();
      const current = yield* self.browser.url();
      const state = buildState(ax as AxNode[], current);
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
      const ax = yield* self.browser.ax();
      const current = yield* self.browser.url();
      const after = buildState(ax as AxNode[], current);
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
      const beforeAx = yield* self.browser.ax();
      const beforeUrl = yield* self.browser.url();
      const before = buildState(beforeAx as AxNode[], beforeUrl);
      const run = yield* self.browser.act(flow.steps);
      const afterAx = yield* self.browser.ax();
      const afterUrl = yield* self.browser.url();
      const after = buildState(afterAx as AxNode[], afterUrl);
      const assertions = yield* self.browser.assert(flow.asserts ?? []);
      const ok = run.ok && assertions.every((assertion) => assertion.ok);
      const witness = ok ? "" : diffStates(before, after).text;
      self.state = after;
      return { ok, failed: run.failed, assertions, witness, tokens: ok ? 10 : 10 + Math.ceil(witness.length / 4) + 40, state: after };
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

  project(query: string): Effect.Effect<Projection | null, BrowserError> {
    const self = this;
    return Effect.sync(() => (self.state ? projectState(self.state, query) : null));
  }

  close(): Effect.Effect<void> {
    return this.browser.close();
  }
}
