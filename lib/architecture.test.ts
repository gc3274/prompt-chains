// Static guards for the gate. Reads source files only and never imports app code,
// so it runs without env vars or a server. Test files are not scanned: they never ship.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_DIRS = ["app", "components", "lib"];
const ROOT_FILES = ["proxy.ts", "next.config.ts"];
const SOURCE_EXT = /\.[cm]?[jt]sx?$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

const GATE = "requireSuperadmin";
const DAL = "@/lib/dal";
const ADMIN_CLIENT = "lib/supabase/admin";
const SIGN_OUT_FILE = "app/auth/actions.ts";
// The only pages a non-admin may load; the proxy tiers them public and session
const NON_ADMIN_PAGES = new Set(["app/login/page.tsx", "app/not-authorized/page.tsx"]);
// The only modules allowed to import the service client
const ADMIN_CLIENT_IMPORTERS = [/^lib\/data\/[^/]+\.ts$/, /^app\/\(admin\)\/(?:.+\/)?actions\.ts$/];

function sourceFiles(): string[] {
  const files = ROOT_FILES.filter((f) => fs.existsSync(path.join(ROOT, f)));
  for (const dir of SOURCE_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { recursive: true, encoding: "utf8" })) {
      const rel = path.posix.join(dir, entry.split(path.sep).join("/"));
      if (SOURCE_EXT.test(rel) && !TEST_FILE.test(rel)) files.push(rel);
    }
  }
  return files.sort();
}

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function parse(rel: string, text: string) {
  const kind = /x$/.test(rel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
}

type Fn = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;

const isFn = (n: ts.Node | undefined): n is Fn =>
  !!n &&
  (ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n));

const hasModifier = (n: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === kind);
const isExported = (n: ts.Node) => hasModifier(n, ts.SyntaxKind.ExportKeyword);

// The leading "use server" / "use client" style strings of a file or function body
function directives(statements: ts.NodeArray<ts.Statement>): string[] {
  const out: string[] = [];
  for (const s of statements) {
    if (!ts.isExpressionStatement(s) || !ts.isStringLiteral(s.expression)) break;
    out.push(s.expression.text);
  }
  return out;
}

// `await requireSuperadmin()` as a statement, or as the whole initializer of a declaration
function awaitsGate(stmt: ts.Statement | undefined): boolean {
  let expr: ts.Expression | undefined;
  if (stmt && ts.isExpressionStatement(stmt)) expr = stmt.expression;
  else if (stmt && ts.isVariableStatement(stmt) && stmt.declarationList.declarations.length === 1) {
    expr = stmt.declarationList.declarations[0].initializer;
  }
  return (
    !!expr &&
    ts.isAwaitExpression(expr) &&
    ts.isCallExpression(expr.expression) &&
    ts.isIdentifier(expr.expression.expression) &&
    expr.expression.expression.text === GATE &&
    expr.expression.arguments.length === 0
  );
}

function startsWithGate(fn: Fn): boolean {
  if (!fn.body || !ts.isBlock(fn.body)) return false;
  const statements = fn.body.statements;
  return awaitsGate(statements[directives(statements).length]);
}

// A local look-alike named requireSuperadmin must not satisfy the check
function importsGate(sf: ts.SourceFile): boolean {
  return sf.statements.some((s) => {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) return false;
    if (s.moduleSpecifier.text !== DAL || s.importClause?.isTypeOnly) return false;
    const named = s.importClause?.namedBindings;
    return (
      !!named &&
      ts.isNamedImports(named) &&
      named.elements.some(
        (e) =>
          !e.isTypeOnly && e.name.text === GATE && (!e.propertyName || e.propertyName.text === GATE),
      )
    );
  });
}

const lineOf = (sf: ts.SourceFile, n: ts.Node) =>
  sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

// Every function a client can call by action ID: the exports of a "use server" file
// and any inline function whose body starts with "use server".
function serverActionViolations(rel: string, text: string): string[] {
  const sf = parse(rel, text);
  const out: string[] = [];
  let gated = false;

  const check = (name: string, node: ts.Node | undefined, at: ts.Node) => {
    if (rel === SIGN_OUT_FILE && name === "signOut") return;
    gated = true;
    if (!isFn(node)) out.push(`${rel}:${lineOf(sf, at)} export ${name} is not a function`);
    else if (!startsWithGate(node)) {
      out.push(`${rel}:${lineOf(sf, at)} ${name} must start with await ${GATE}()`);
    }
  };

  if (directives(sf.statements).includes("use server")) {
    for (const s of sf.statements) {
      if (ts.isFunctionDeclaration(s) && isExported(s)) check(s.name?.text ?? "default", s, s);
      else if (ts.isVariableStatement(s) && isExported(s)) {
        for (const d of s.declarationList.declarations) check(d.name.getText(sf), d.initializer, d);
      } else if (ts.isExportAssignment(s)) check("default", s.expression, s);
      else if (ts.isExportDeclaration(s) && !s.isTypeOnly) {
        out.push(`${rel}:${lineOf(sf, s)} re-exports can't be checked; define actions in this file`);
      } else if (isExported(s) && !ts.isInterfaceDeclaration(s) && !ts.isTypeAliasDeclaration(s)) {
        out.push(`${rel}:${lineOf(sf, s)} only async functions may be exported`);
      }
    }
  }

  const visit = (node: ts.Node) => {
    if (isFn(node) && node.body && ts.isBlock(node.body)) {
      if (directives(node.body.statements).includes("use server")) {
        gated = true;
        if (!startsWithGate(node)) {
          out.push(`${rel}:${lineOf(sf, node)} inline server function must start with await ${GATE}()`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (gated && !importsGate(sf)) out.push(`${rel} must import { ${GATE} } from "${DAL}"`);
  return out;
}

function defaultExportFn(sf: ts.SourceFile): Fn | undefined {
  const local = (name: string): Fn | undefined => {
    for (const s of sf.statements) {
      if (ts.isFunctionDeclaration(s) && s.name?.text === name) return s;
      if (ts.isVariableStatement(s)) {
        for (const d of s.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === name && isFn(d.initializer)) {
            return d.initializer;
          }
        }
      }
    }
  };
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && isExported(s) && hasModifier(s, ts.SyntaxKind.DefaultKeyword)) {
      return s;
    }
    if (ts.isExportAssignment(s) && !s.isExportEquals) {
      if (isFn(s.expression)) return s.expression;
      if (ts.isIdentifier(s.expression)) return local(s.expression.text);
    }
  }
}

function pageViolations(rel: string, text: string): string[] {
  const sf = parse(rel, text);
  const fn = defaultExportFn(sf);
  const out: string[] = [];
  if (!fn) out.push(`${rel} has no default-exported page function`);
  else if (!startsWithGate(fn)) out.push(`${rel} page must start with await ${GATE}()`);
  if (!importsGate(sf)) out.push(`${rel} must import { ${GATE} } from "${DAL}"`);
  return out;
}

// Every module specifier a file pulls in, resolved to a repo path without extension
function importedModules(rel: string, text: string): string[] {
  const sf = parse(rel, text);
  const specs: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) specs.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) {
        specs.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return specs.flatMap((spec) => {
    let target: string;
    if (spec.startsWith("@/")) target = spec.slice(2);
    else if (spec.startsWith(".")) target = path.posix.join(path.posix.dirname(rel), spec);
    else return [];
    return [path.posix.normalize(target).replace(SOURCE_EXT, "").replace(/\/index$/, "")];
  });
}

describe("architecture checkers (fixtures)", () => {
  const ACTIONS = "app/(admin)/media/actions.ts";
  const head = `"use server";\nimport { requireSuperadmin } from "@/lib/dal";\n`;

  it("accept actions that open with the gate", () => {
    const ok = `${head}
      export type EditState = { ok: boolean };
      export async function updateRoast(prev: EditState, fd: FormData): Promise<EditState> {
        await requireSuperadmin();
        return { ok: fd.has("id") };
      }
      export const deleteRoast = async (fd: FormData) => {
        const admin = await requireSuperadmin();
        return [admin, fd];
      };
      export default async function createRoast() {
        await requireSuperadmin();
      }`;
    expect(serverActionViolations(ACTIONS, ok)).toEqual([]);
  });

  it("reject actions that skip, delay, or fake the gate", () => {
    const cases = {
      missing: `${head}export async function a(fd: FormData) { return fd; }`,
      second: `${head}export async function a(fd: FormData) { const id = fd.get("id"); await requireSuperadmin(); return id; }`,
      notAwaited: `${head}export async function a() { requireSuperadmin(); }`,
      conditional: `${head}export async function a(x: boolean) { if (x) await requireSuperadmin(); }`,
      withArgs: `${head}export async function a() { await requireSuperadmin("x"); }`,
      expressionBody: `${head}export const a = async () => doIt();`,
      reExport: `${head}export { a } from "./other";`,
      exportList: `${head}async function a() { await requireSuperadmin(); }\nexport { a };`,
      nonFunction: `${head}export const LIMIT = 5;`,
      exportedClass: `${head}export class A {}`,
      signOutElsewhere: `${head}export async function signOut() {}`,
    };
    for (const [name, text] of Object.entries(cases)) {
      expect(serverActionViolations(ACTIONS, text), name).not.toEqual([]);
    }
  });

  it("reject a gate that is not the DAL's", () => {
    const local = `"use server";\nconst requireSuperadmin = async () => {};\nexport async function a() { await requireSuperadmin(); }`;
    const elsewhere = `"use server";\nimport { requireSuperadmin } from "@/lib/fake";\nexport async function a() { await requireSuperadmin(); }`;
    const renamed = `"use server";\nimport { getViewer as requireSuperadmin } from "@/lib/dal";\nexport async function a() { await requireSuperadmin(); }`;
    for (const text of [local, elsewhere, renamed]) {
      expect(serverActionViolations(ACTIONS, text)).not.toEqual([]);
    }
  });

  it("exempt only signOut, and only in app/auth/actions.ts", () => {
    const signOut = `"use server";\nexport async function signOut() { return; }`;
    expect(serverActionViolations(SIGN_OUT_FILE, signOut)).toEqual([]);
    expect(serverActionViolations(SIGN_OUT_FILE, `${signOut}\nexport async function other() {}`)).not.toEqual([]);
  });

  it("check inline server functions in any file", () => {
    const page = "app/(admin)/media/[id]/page.tsx";
    const bad = `export default function P() { return <form action={async () => { "use server"; drop(); }} />; }`;
    const good = `import { requireSuperadmin } from "@/lib/dal";\nexport default function P() { return <form action={async () => { "use server"; await requireSuperadmin(); }} />; }`;
    expect(serverActionViolations(page, bad)).not.toEqual([]);
    expect(serverActionViolations(page, good)).toEqual([]);
    expect(serverActionViolations("lib/plain.ts", `export async function f() { return 1; }`)).toEqual([]);
  });

  it("accept pages that open with the gate, in either export style", () => {
    const imp = `import { requireSuperadmin } from "@/lib/dal";\n`;
    const decl = `${imp}export default async function Page({ searchParams }: { searchParams: Promise<object> }) { await requireSuperadmin(); return searchParams; }`;
    const named = `${imp}async function Page() { const admin = await requireSuperadmin(); return admin; }\nexport default Page;`;
    expect(pageViolations("app/(admin)/page.tsx", decl)).toEqual([]);
    expect(pageViolations("app/(admin)/page.tsx", named)).toEqual([]);
  });

  it("reject pages that do anything before the gate, or never gate", () => {
    const imp = `import { requireSuperadmin } from "@/lib/dal";\n`;
    const cases = {
      paramsFirst: `${imp}export default async function P({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; await requireSuperadmin(); return id; }`,
      none: `${imp}export default async function P() { return null; }`,
      notImported: `export default async function P() { await requireSuperadmin(); }`,
      sync: `${imp}export default function P() { return null; }`,
      noDefault: `${imp}export async function P() { await requireSuperadmin(); }`,
    };
    for (const [name, text] of Object.entries(cases)) {
      expect(pageViolations("app/(admin)/users/page.tsx", text), name).not.toEqual([]);
    }
  });

  it("resolve every import form to a repo path", () => {
    const text = `import a from "@/lib/supabase/admin";\nimport b from "./admin.ts";\nexport * from "../supabase/admin";\nconst c = await import("@/lib/supabase/admin");\nconst d = require("@/lib/supabase/admin/index");\nimport "react";`;
    expect(importedModules("lib/supabase/x.ts", text)).toEqual([
      ADMIN_CLIENT,
      ADMIN_CLIENT,
      ADMIN_CLIENT,
      ADMIN_CLIENT,
      ADMIN_CLIENT,
    ]);
  });
});

describe("architecture (this repo)", () => {
  const files = sourceFiles();
  const text = new Map(files.map((f) => [f, read(f)]));
  const containing = (needle: string | RegExp) =>
    files.filter((f) => {
      const t = text.get(f) ?? "";
      return typeof needle === "string" ? t.includes(needle) : needle.test(t);
    });

  it("scans the files the gate lives in", () => {
    for (const f of ["proxy.ts", "lib/dal.ts", "lib/supabase/admin.ts", "lib/supabase/proxy.ts"]) {
      expect(files).toContain(f);
    }
  });

  it("lets only lib/data/* and app/(admin)/**/actions.ts import the service client", () => {
    const importers = files.filter((f) => importedModules(f, text.get(f) ?? "").includes(ADMIN_CLIENT));
    expect(importers.filter((f) => !ADMIN_CLIENT_IMPORTERS.some((re) => re.test(f)))).toEqual([]);
  });

  it("reads the service key only in lib/supabase/admin.ts", () => {
    expect(containing("SUPABASE_SERVICE_ROLE_KEY")).toEqual(["lib/supabase/admin.ts"]);
  });

  it("never names a public service key", () => {
    expect(containing("NEXT_PUBLIC_SUPABASE_SERVICE")).toEqual([]);
  });

  it("opens every admin page with await requireSuperadmin()", () => {
    const pages = files.filter((f) => /^app\/(?:.+\/)?page\.[jt]sx?$/.test(f));
    expect(pages.length).toBeGreaterThan(0);
    const admin = pages.filter((f) => !NON_ADMIN_PAGES.has(f));
    expect(admin.flatMap((f) => pageViolations(f, text.get(f) ?? ""))).toEqual([]);
  });

  it("opens every server action with await requireSuperadmin(), except signOut", () => {
    expect(files.flatMap((f) => serverActionViolations(f, text.get(f) ?? ""))).toEqual([]);
  });

  it("keeps the DAL and both server clients out of client bundles", () => {
    for (const f of ["lib/dal.ts", "lib/supabase/admin.ts", "lib/supabase/server.ts"]) {
      const sf = parse(f, text.get(f) ?? "");
      const first = sf.statements[0];
      const ok =
        !!first &&
        ts.isImportDeclaration(first) &&
        !first.importClause &&
        ts.isStringLiteral(first.moduleSpecifier) &&
        first.moduleSpecifier.text === "server-only";
      expect(ok, f).toBe(true);
    }
  });

  it("never renders raw HTML", () => {
    expect(containing("dangerouslySetInnerHTML")).toEqual([]);
  });

  it("never caches across requests", () => {
    expect(containing(/["'`]use cache/)).toEqual([]);
  });
});
