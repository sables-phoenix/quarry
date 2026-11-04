import type { Step, Assertion } from "./types.js";
export type Flow = { name: string; path: string; steps: Step[]; asserts: Assertion[] };

export const FLOWS: Flow[] = [
  {
    name: "login ok",
    path: "/login.html",
    steps: [
      { op: "fill", role: "email", name: "email", value: "ada@example.com" },
      { op: "fill", role: "password", name: "password", value: "correct-horse" },
      { op: "click", role: "button", name: "continue" },
    ],
    asserts: [{ op: "text", value: "welcome back" }],
  },
  {
    name: "login error",
    path: "/login.html",
    steps: [
      { op: "fill", role: "email", name: "email", value: "x@y.z" },
      { op: "fill", role: "password", name: "password", value: "nope" },
      { op: "click", role: "button", name: "continue" },
    ],
    asserts: [{ op: "text", value: "invalid credentials" }],
  },
  {
    name: "signup validation",
    path: "/signup.html",
    steps: [
      { op: "fill", role: "textbox", name: "name", value: "Ada" },
      { op: "fill", role: "textbox", name: "email", value: "nope" },
      { op: "click", role: "button", name: "create account" },
    ],
    asserts: [{ op: "text", value: "email invalid" }],
  },
  {
    name: "wizard",
    path: "/wizard.html",
    steps: [
      { op: "fill", role: "textbox", name: "full name", value: "Ada Lovelace" },
      { op: "click", role: "button", name: "next" },
      { op: "fill", role: "textbox", name: "company", value: "Analytical" },
      { op: "click", role: "button", name: "next" },
    ],
    asserts: [{ op: "text", value: "step 3" }],
  },
  {
    name: "todo add",
    path: "/todo.html",
    steps: [
      { op: "fill", role: "textbox", name: "new todo", value: "buy milk" },
      { op: "click", role: "button", name: "add" },
    ],
    asserts: [{ op: "text", value: "buy milk" }],
  },
  {
    name: "todo toggle",
    path: "/todo.html",
    steps: [
      { op: "fill", role: "textbox", name: "new todo", value: "buy milk" },
      { op: "click", role: "button", name: "add" },
      { op: "click", role: "button", name: "done buy milk" },
    ],
    asserts: [{ op: "text", value: "undo" }],
  },
  {
    name: "list filter",
    path: "/list.html",
    steps: [{ op: "fill", role: "textbox", name: "filter", value: "item 4" }],
    asserts: [{ op: "count", selector: "#ul li", value: 11 }],
  },
  {
    name: "pagination",
    path: "/pagination.html",
    steps: [
      { op: "click", role: "button", name: "next" },
      { op: "click", role: "button", name: "next" },
    ],
    asserts: [{ op: "text", value: "page 3" }],
  },
  {
    name: "modal confirm",
    path: "/modal.html",
    steps: [
      { op: "click", role: "button", name: "delete account" },
      { op: "click", role: "button", name: "yes delete" },
    ],
    asserts: [{ op: "text", value: "account deleted" }],
  },
  {
    name: "modal cancel",
    path: "/modal.html",
    steps: [
      { op: "click", role: "button", name: "delete account" },
      { op: "click", role: "button", name: "keep account" },
    ],
    asserts: [{ op: "text", value: "account kept" }],
  },
  {
    name: "tabs",
    path: "/tabs.html",
    steps: [{ op: "click", role: "tab", name: "billing" }],
    asserts: [{ op: "text", value: "billing content" }],
  },
  {
    name: "table sort",
    path: "/table.html",
    steps: [{ op: "click", role: "button", name: "price" }],
    asserts: [{ op: "text", value: "alpha" }],
  },
  {
    name: "async load",
    path: "/async.html",
    steps: [
      { op: "click", role: "button", name: "load report" },
      { op: "wait", ms: 1000 },
    ],
    asserts: [{ op: "text", value: "report ready" }],
  },
  {
    name: "form submit",
    path: "/form.html",
    steps: [
      { op: "select", name: "plan", value: "pro" },
      { op: "check", name: "newsletter", value: true },
      { op: "click", role: "button", name: "save" },
    ],
    asserts: [{ op: "text", value: "pro / monthly / newsletter on" }],
  },
  {
    name: "disabled",
    path: "/disabled.html",
    steps: [
      { op: "fill", role: "textbox", name: "code", value: "123" },
      { op: "click", role: "button", name: "verify" },
    ],
    asserts: [{ op: "text", value: "verified 123" }],
  },
  {
    name: "spa route",
    path: "/spa.html",
    steps: [{ op: "click", role: "link", name: "reports" }],
    asserts: [{ op: "text", value: "reports screen" }],
  },
  {
    name: "shadow dom",
    path: "/shadow.html",
    steps: [{ op: "click", role: "button", name: "activate widget" }],
    asserts: [{ op: "text", value: "widget active" }],
  },
  {
    name: "iframe",
    path: "/iframe.html",
    steps: [
      { op: "click", role: "button", name: "inner action" },
      { op: "wait", ms: 300 },
    ],
    asserts: [{ op: "text", value: "inner done" }],
  },
  {
    name: "dialog chain",
    path: "/dashboard.html",
    steps: [
      { op: "click", role: "button", name: "open dialog" },
      { op: "click", role: "button", name: "confirm" },
      { op: "click", role: "button", name: "increment" },
    ],
    asserts: [{ op: "text", value: "1" }],
  },
];
