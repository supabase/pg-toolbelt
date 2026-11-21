/**
 * Deterministic scenario generator for the owner-lab.
 *
 *   bun packages/pg-delta/tests/owner-lab/gen/generate.ts [--out <dir>] [--only <regex>]
 *
 * See gen/README.md. a.sql and b.sql are assembled from the same builder
 * (`buildSide`), differing only by the transition's per-side spec.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  KIND_BY_ID,
  KINDS,
  type Kind,
  type KindId,
  type ObjCtx,
} from "./kinds.ts";

// ── dimensions ───────────────────────────────────────────────────────────────
export type Transition =
  | "new-to-r"
  | "app-to-r"
  | "r1-to-r2"
  | "r-modify"
  | "r-modify-acl"
  | "r-drop"
  | "r-drop-role"
  | "r-to-app-drop-role";
export type Mem = "none" | "kept" | "kept-desired" | "kept-source";
export type Sch = "own" | "r-owned" | "other-owned" | "public" | "self";
export type Create = "direct" | "temp" | "public-grant" | "na";
export type Acl = "none" | "reader" | "holder" | "na";
export type Modifier =
  | "none"
  | "enum-boundary"
  | "two-objects"
  | "noinherit"
  | "dbowner-super";

export const TRANSITIONS: Transition[] = [
  "new-to-r",
  "app-to-r",
  "r1-to-r2",
  "r-modify",
  "r-modify-acl",
  "r-drop",
  "r-drop-role",
  "r-to-app-drop-role",
];
const MEMS: Mem[] = ["none", "kept", "kept-desired", "kept-source"];
const SCHS: Sch[] = ["own", "r-owned", "other-owned", "public"];
const CREATES: Create[] = ["direct", "temp", "public-grant"];
const ACLS: Acl[] = ["none", "reader", "holder"];
const MODIFIERS: Modifier[] = [
  "enum-boundary",
  "two-objects",
  "noinherit",
  "dbowner-super",
];

export interface Sc {
  kind: KindId;
  transition: Transition;
  mem: Mem;
  sch: Sch;
  create: Create;
  acl: Acl;
  modifier: Modifier;
  bucket: string;
}

/** Combination that cannot be expressed (excluded) or that collapses a dimension. */
export function normalize(sc: Sc): Sc | undefined {
  const k = KIND_BY_ID.get(sc.kind) as Kind;
  const out = { ...sc };
  if (sc.kind === "schema") {
    out.sch = "self";
    out.create = "na";
  }
  if (sc.kind === "publication") out.create = "na";
  if (out.sch === "r-owned") out.create = "na";
  if (!k.priv) out.acl = "na";
  if (!k.priv && sc.transition === "r-modify-acl") return undefined;
  if (out.sch === "r-owned" && sc.transition === "r-drop-role")
    return undefined;
  if (
    out.sch !== "r-owned" &&
    out.sch !== "self" &&
    sc.kind !== "publication" &&
    out.create === "na"
  )
    return undefined;
  return out;
}

// ── per-side spec ────────────────────────────────────────────────────────────
interface Side {
  /** owner of the main object (and companions): "absent", "app", or a role name */
  obj: string;
  mod: boolean;
  delta: null | "old" | "new";
  /** owner roles that exist on this side */
  roles: string[];
  keep: boolean;
}

function sidesOf(sc: Sc): [Side, Side] {
  const keeps: Record<Mem, [boolean, boolean]> = {
    none: [false, false],
    kept: [true, true],
    "kept-desired": [false, true],
    "kept-source": [true, false],
  };
  const [ka, kb] = keeps[sc.mem];
  const s = (
    obj: string,
    roles: string[],
    keep: boolean,
    mod = false,
    delta: Side["delta"] = null,
  ): Side => ({ obj, mod, delta, roles, keep });
  switch (sc.transition) {
    case "new-to-r":
      return [s("absent", ["r"], ka), s("r", ["r"], kb)];
    case "app-to-r":
      return [s("app", ["r"], ka), s("r", ["r"], kb)];
    case "r1-to-r2":
      return [s("r1", ["r1", "r2"], ka), s("r2", ["r1", "r2"], kb)];
    case "r-modify":
      return [s("r", ["r"], ka), s("r", ["r"], kb, true)];
    case "r-modify-acl":
      return [s("r", ["r"], ka, false, "old"), s("r", ["r"], kb, false, "new")];
    case "r-drop":
      return [s("r", ["r"], ka), s("absent", ["r"], kb)];
    case "r-drop-role":
      return [s("r", ["r"], ka), s("absent", [], kb)];
    case "r-to-app-drop-role":
      return [s("r", ["r"], ka), s("app", [], kb)];
  }
}

const isRole = (o: string): boolean => o !== "absent" && o !== "app";

function schemaOwner(sc: Sc, side: Side): string {
  switch (sc.sch) {
    case "own":
      return "app";
    case "public":
      return "public";
    case "other-owned":
      return "s_owner";
    case "r-owned":
      if (side.obj === "app") return "app";
      if (isRole(side.obj)) return side.obj;
      if (side.roles[0] === undefined) throw new Error("r-owned without role");
      return side.roles[0];
    default:
      return "app";
  }
}

const dbGrant = (verb: "GRANT" | "REVOKE", role: string): string =>
  `DO $$ BEGIN EXECUTE format('${verb} CREATE ON DATABASE %I ${verb === "GRANT" ? "TO" : "FROM"} ${role}', current_database()); END $$;`;

// ── side builder ─────────────────────────────────────────────────────────────
const TABLE = KIND_BY_ID.get("table") as Kind;

export function buildSide(sc: Sc, side: Side, desired: boolean): string {
  const kind = KIND_BY_ID.get(sc.kind) as Kind;
  const isSchemaKind = sc.kind === "schema";
  const S = isSchemaKind ? "s" : sc.sch === "public" ? "public" : "s";
  const present = side.obj !== "absent";
  const schemaExists = isSchemaKind ? present : true;
  const holder = sc.acl === "holder";
  const L: string[] = [];
  const main: ObjCtx = { S, n: isSchemaKind ? "s" : "o1", mod: side.mod };
  const second: ObjCtx = { S, n: "o2", mod: side.mod };
  const acl = kind.priv !== undefined;

  // roles
  const helpers: string[] = [];
  if (sc.acl === "reader" || holder || sc.kind === "table-rls")
    helpers.push("reader");
  if (holder) helpers.push("holder");
  if (sc.transition === "r-modify-acl")
    helpers.push("grantee_old", "grantee_new");
  if (sc.sch === "other-owned") helpers.push("s_owner");
  for (const r of [...side.roles, ...helpers])
    L.push(`CREATE ROLE ${r} NOLOGIN;`);

  // which roles the applier must hold while building
  const sOwner = isSchemaKind ? "app" : schemaOwner(sc, side);
  const member = [...side.roles, ...(holder ? ["holder"] : [])];
  const used = new Set<string>();
  if (isRole(side.obj) && present) used.add(side.obj);
  if (isRole(sOwner)) used.add(sOwner);
  if (holder) used.add("holder");
  const keepSet = new Set(side.keep ? member : []);
  const grants = member.filter((r) => used.has(r) || keepSet.has(r));
  const revokes = member.filter((r) => used.has(r) && !keepSet.has(r));
  for (const r of grants) L.push(`GRANT ${r} TO current_user;`);

  // schema
  if (!isSchemaKind) {
    if (sc.sch === "own" || sc.sch === "r-owned") L.push(`CREATE SCHEMA ${S};`);
    if (sc.sch === "other-owned") {
      L.push(
        "GRANT s_owner TO current_user;",
        `CREATE SCHEMA ${S} AUTHORIZATION s_owner;`,
        "SET ROLE s_owner;",
        `GRANT USAGE, CREATE ON SCHEMA ${S} TO session_user WITH GRANT OPTION;`,
        "RESET ROLE;",
        "REVOKE s_owner FROM current_user;",
      );
    }
    if (holder && sc.sch !== "public")
      L.push(`GRANT USAGE ON SCHEMA ${S} TO holder;`);
  }
  if (schemaExists && !isSchemaKind) {
    if (sc.create === "public-grant")
      L.push(`GRANT CREATE ON SCHEMA ${S} TO PUBLIC;`);
    if (sc.create === "direct")
      for (const r of member) L.push(`GRANT CREATE ON SCHEMA ${S} TO ${r};`);
  }

  // objects
  if (!isSchemaKind) {
    L.push(...(kind.support?.(main) ?? []));
    if (sc.modifier === "enum-boundary")
      L.push(
        `CREATE TYPE ${S}.bnd_enum AS ENUM ('a'${desired ? ", 'b'" : ""});`,
        `CREATE TABLE ${S}.bnd_t (id int, m ${S}.bnd_enum DEFAULT '${desired ? "b" : "a"}');`,
      );
  }
  if (present) {
    L.push(...kind.create(main));
    if (sc.modifier === "two-objects") L.push(...TABLE.create(second));
    if (acl && kind.priv) {
      const p = kind.priv;
      const grantsTo: string[] = [];
      if (sc.acl === "reader") grantsTo.push(...p.grant(main, "reader", false));
      if (holder) grantsTo.push(...p.grant(main, "holder", true));
      if (side.delta === "old")
        grantsTo.push(...p.grant(main, "grantee_old", false));
      if (side.delta === "new")
        grantsTo.push(...p.grant(main, "grantee_new", false));
      if (grantsTo.length > 0)
        L.push(...(p.revokePublic?.(main) ?? []), ...grantsTo);
      if (holder)
        L.push(
          "SET ROLE holder;",
          ...p.grant(main, "reader", false),
          "RESET ROLE;",
        );
    }
  }
  if (holder && schemaExists) {
    L.push(
      `CREATE TABLE ${S}.holder_t (id int${desired ? ", extra int" : ""});`,
    );
  }

  // ownership moves
  const needDb =
    sc.kind === "schema" || sc.kind === "publication" || sc.sch === "r-owned";
  if (needDb) for (const r of side.roles) L.push(dbGrant("GRANT", r));
  const temp = sc.create === "temp" || sc.create === "na";
  if (temp && schemaExists)
    for (const r of member) L.push(`GRANT CREATE ON SCHEMA ${S} TO ${r};`);
  if (present && isRole(side.obj) && !isSchemaKind) {
    L.push(...kind.move(main, side.obj));
    if (sc.modifier === "two-objects") L.push(...TABLE.move(second, side.obj));
  }
  if (holder && schemaExists)
    L.push(`ALTER TABLE ${S}.holder_t OWNER TO holder;`);
  if (temp && schemaExists)
    for (const r of member) L.push(`REVOKE CREATE ON SCHEMA ${S} FROM ${r};`);
  if (isSchemaKind && present && isRole(side.obj))
    L.push(...kind.move(main, side.obj));
  if (sc.sch === "r-owned" && isRole(sOwner))
    L.push(`ALTER SCHEMA ${S} OWNER TO ${sOwner};`);
  if (needDb) for (const r of side.roles) L.push(dbGrant("REVOKE", r));
  for (const r of revokes) L.push(`REVOKE ${r} FROM current_user;`);

  return L.join("\n") + "\n";
}

// ── naming / meta ────────────────────────────────────────────────────────────
const SCH_NAME: Record<Sch, string> = {
  own: "own",
  "r-owned": "rown",
  "other-owned": "other",
  public: "public",
  self: "self",
};

export function nameOf(sc: Sc): string {
  const k = KIND_BY_ID.get(sc.kind) as Kind;
  const parts = [
    `g-${k.short}`,
    sc.transition,
    `mem-${sc.mem}`,
    `sch-${SCH_NAME[sc.sch]}`,
    `create-${sc.create}`,
    `acl-${sc.acl}`,
  ];
  if (sc.modifier !== "none") parts.push(`mod-${sc.modifier}`);
  return parts.join("--");
}

function metaOf(sc: Sc): Record<string, unknown> {
  const tags = [
    `bucket:${sc.bucket}`,
    `kind:${sc.kind}`,
    `transition:${sc.transition}`,
    `membership:${sc.mem}`,
    `schema:${sc.sch}`,
    `create:${sc.create}`,
    `acl:${sc.acl}`,
    `modifier:${sc.modifier}`,
  ];
  const needsDb =
    sc.kind === "schema" || sc.kind === "publication" || sc.sch === "r-owned";
  if (needsDb) tags.push("needs-db-create");
  const desc = `${sc.kind}: ${sc.transition}; applier membership ${sc.mem}; schema ${sc.sch}; new owner CREATE ${sc.create}; acl ${sc.acl}${sc.modifier === "none" ? "" : `; modifier ${sc.modifier}`}`;
  const meta: Record<string, unknown> = {
    ideal: "converge",
    tags,
    notes: desc,
  };
  let minVersion = 14;
  if (sc.sch === "public") minVersion = Math.max(minVersion, 15);
  if (sc.modifier === "noinherit") {
    minVersion = Math.max(minVersion, 16);
    meta["applierInherit"] = false;
  }
  if (sc.modifier === "dbowner-super") meta["dbOwner"] = "superuser";
  if (minVersion > 14) meta["minVersion"] = minVersion;
  return meta;
}

// ── coverage plan ────────────────────────────────────────────────────────────
interface Tuple {
  mem: Mem;
  sch: Sch;
  create: Create;
  acl: Acl;
}

function pairwise(kind: KindId, transition: Transition): Tuple[] {
  const base: Sc = {
    kind,
    transition,
    mem: "none",
    sch: "own",
    create: "temp",
    acl: "reader",
    modifier: "none",
    bucket: "pairwise",
  };
  const cands: Tuple[] = [];
  const seen = new Set<string>();
  for (const mem of MEMS)
    for (const sch of SCHS)
      for (const create of [...CREATES, "na" as Create])
        for (const acl of ACLS) {
          const n = normalize({ ...base, mem, sch, create, acl });
          if (!n) continue;
          const t = { mem: n.mem, sch: n.sch, create: n.create, acl: n.acl };
          const key = JSON.stringify(t);
          if (!seen.has(key)) {
            seen.add(key);
            cands.push(t);
          }
        }
  const dims = ["mem", "sch", "create", "acl"] as const;
  const pairsOf = (t: Tuple): string[] => {
    const out: string[] = [];
    for (let i = 0; i < dims.length; i++)
      for (let j = i + 1; j < dims.length; j++) {
        const x = dims[i] as keyof Tuple;
        const y = dims[j] as keyof Tuple;
        out.push(`${x}=${t[x]}|${y}=${t[y]}`);
      }
    return out;
  };
  const uncovered = new Set(cands.flatMap(pairsOf));
  const chosen: Tuple[] = [];
  while (uncovered.size > 0) {
    let best: Tuple | undefined;
    let bestN = -1;
    for (const t of cands) {
      const n = pairsOf(t).filter((p) => uncovered.has(p)).length;
      if (n > bestN) {
        best = t;
        bestN = n;
      }
    }
    if (!best) break;
    chosen.push(best);
    for (const p of pairsOf(best)) uncovered.delete(p);
  }
  return chosen;
}

export function plan(): Sc[] {
  const all = new Map<string, Sc>();
  const add = (sc: Sc): void => {
    const n = normalize(sc);
    if (!n) return;
    const nm = nameOf(n);
    if (!all.has(nm)) all.set(nm, n);
  };
  const base = (kind: KindId, transition: Transition, bucket: string): Sc => ({
    kind,
    transition,
    mem: "none",
    sch: "own",
    create: "temp",
    acl: "reader",
    modifier: "none",
    bucket,
  });
  // 1. core
  for (const k of KINDS)
    for (const t of TRANSITIONS) add(base(k.id, t, "core"));
  // 2. pairwise
  const pwKinds: KindId[] = ["table-rls", "function", "view", "serial"];
  const pwTrans: Transition[] = [
    "new-to-r",
    "app-to-r",
    "r1-to-r2",
    "r-modify",
    "r-modify-acl",
  ];
  for (const k of pwKinds)
    for (const t of pwTrans)
      for (const tu of pairwise(k, t))
        add({ ...base(k, t, "pairwise"), ...tu });
  // 3. modifiers
  const mKinds: KindId[] = ["table-rls", "function", "enum"];
  const mTrans: Transition[] = ["new-to-r", "r1-to-r2", "r-modify"];
  for (const m of MODIFIERS)
    for (const k of mKinds)
      for (const t of mTrans) add({ ...base(k, t, "modifiers"), modifier: m });
  return [...all.values()];
}

export function main(argv: string[]): void {
  let out = join(dirname(fileURLToPath(import.meta.url)), "..", "generated");
  let only: RegExp | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out = argv[++i] as string;
    else if (argv[i] === "--only") only = new RegExp(argv[++i] as string);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  const scs = plan().filter((sc) => !only || only.test(nameOf(sc)));
  if (existsSync(out)) {
    for (const d of readdirSync(out))
      if (d.startsWith("g-") && (!only || only.test(d)))
        rmSync(join(out, d), { recursive: true, force: true });
  }
  mkdirSync(out, { recursive: true });
  const counts = new Map<string, number>();
  for (const sc of scs) {
    const dir = join(out, nameOf(sc));
    mkdirSync(dir, { recursive: true });
    const [a, b] = sidesOf(sc);
    const hdr = (side: string): string =>
      `-- generated by owner-lab/gen/generate.ts: ${nameOf(sc)} (${side})\n`;
    writeFileSync(join(dir, "a.sql"), hdr("source") + buildSide(sc, a, false));
    writeFileSync(join(dir, "b.sql"), hdr("desired") + buildSide(sc, b, true));
    writeFileSync(
      join(dir, "meta.json"),
      `${JSON.stringify(metaOf(sc), null, 2)}\n`,
    );
    counts.set(sc.bucket, (counts.get(sc.bucket) ?? 0) + 1);
  }
  for (const [k, v] of counts) console.log(`${k}: ${v}`);
  console.log(`total: ${scs.length} -> ${out}`);
}

if (import.meta.main) main(process.argv.slice(2));
