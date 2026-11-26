// Known pg-topo bugs found by the Ephyra property tests (ephyra/pg-topo,
// supabase/pg-toolbelt#614; tracked in CLI-3292). Each input is valid SQL given
// in a wrong order or shape, and each test asserts the correct behavior.
//
// They are `test.failing` until fixed. A fix PR turns its tests into plain
// `test`s and removes the matching generator mask in ephyra/pg-topo
// (`PGTOPO_UNMASK`, see ephyra/README.md).
//
// #659 (quadratic graph build) has no test here: it is a scaling issue and a
// timing assertion would be flaky in CI.
import { afterAll, describe, expect, test } from "bun:test";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { analyzeAndSort } from "../src/analyze-and-sort";
import { analyzeAndSortFromFiles } from "../src/from-files";
import { createTempFixtureHarness } from "./support/temp-fixture";

const order = async (sql: string[]): Promise<string[]> =>
  (await analyzeAndSort(sql)).ordered.map((s) => s.sql);

const before = (ordered: string[], a: string, b: string): boolean => {
  const ia = ordered.findIndex((s) => s.includes(a));
  const ib = ordered.findIndex((s) => s.includes(b));
  return ia !== -1 && ib !== -1 && ia < ib;
};

const requiresOf = async (sql: string[], needle: string): Promise<string[]> => {
  const r = await analyzeAndSort(sql);
  const node = r.ordered.find((s) => s.sql.includes(needle));
  return (node?.requires ?? []).map(
    (x) => `${x.kind}:${x.schema ?? ""}.${x.name}`,
  );
};

const codes = async (sql: string[], code?: string): Promise<string[]> =>
  (await analyzeAndSort(sql)).diagnostics
    .map((d) => d.code)
    .filter((c) => code === undefined || c === code);

const fnK =
  "create function public.k(int) returns int language sql immutable as 'select $1'";
const fnP =
  "create function public.p(int) returns bool language sql immutable as 'select true'";

describe("#643 / CLI-3260 composite type attribute types are not dependencies", () => {
  test.failing("composite attribute type orders first", async () => {
    const o = await order([
      "create type public.outer_t as (f public.inner_t)",
      "create type public.inner_t as (x int)",
    ]);
    expect(before(o, "inner_t as", "outer_t as")).toBe(true);
  });
});

describe("#644 / CLI-3261 SQL-standard function bodies contribute no dependencies", () => {
  test.failing("RETURN body depends on the called function", async () => {
    const o = await order([
      "create function public.f2(a int) returns int language sql immutable return public.f1(a)",
      "create function public.f1(a int) returns int language sql immutable return a",
    ]);
    expect(before(o, "public.f1(a int)", "public.f2")).toBe(true);
  });

  test.failing(
    "BEGIN ATOMIC body depends on the relation it reads",
    async () => {
      const o = await order([
        "create function public.n() returns bigint language sql stable begin atomic select count(*) from public.v; end",
        "create view public.v as select 1 as x",
      ]);
      expect(before(o, "create view", "public.n()")).toBe(true);
    },
  );
});

describe("#645 / CLI-3262 OWNED BY t.c with an unqualified table", () => {
  test.failing("resolves t as the table", async () => {
    const sql = [
      "create sequence public.s",
      "alter sequence public.s owned by t.c",
      "create table public.t (c int)",
    ];
    expect(await codes(sql, "UNRESOLVED_DEPENDENCY")).toEqual([]);
  });

  test.failing("orders the table before OWNED BY", async () => {
    const o = await order([
      "create sequence public.s",
      "alter sequence public.s owned by t.c",
      "create table public.t (c int)",
    ]);
    expect(before(o, "create table", "owned by")).toBe(true);
  });
});

describe("#646 / CLI-3263 ALTER TABLE ADD COLUMN does not provide the column", () => {
  test.failing(
    "ADD COLUMN orders before statements using the column",
    async () => {
      const o = await order([
        "create table public.t (id int)",
        "alter table public.t alter column c set default 1",
        "alter table public.t add column c int",
      ]);
      expect(before(o, "add column c", "alter column c")).toBe(true);
    },
  );
});

describe("#647 / CLI-3264 PL/pgSQL DECLARE types are not dependencies", () => {
  test.failing("%rowtype depends on the relation", async () => {
    const o = await order([
      "create function public.f() returns int language plpgsql as $$ declare v public.v%rowtype; begin return 1; end $$",
      "create view public.v as select 1 as x",
    ]);
    expect(before(o, "create view", "create function")).toBe(true);
  });
});

describe("#648 / CLI-3265 nextval('public.\"Seq1\"'::regclass) case-folds the name", () => {
  test.failing("quoted sequence name keeps its case", async () => {
    const r = await requiresOf(
      [
        `create table public.t (c bigint default nextval('public."Seq1"'::regclass))`,
        `create sequence public."Seq1"`,
      ],
      "create table",
    );
    expect(r).toContain("sequence:public.Seq1");
  });
});

describe("#649 / CLI-3266 CREATE SCHEMA elements contribute no dependencies", () => {
  test.failing("nested CREATE VIEW depends on the table it reads", async () => {
    const o = await order([
      "create schema app create view w as select id from public.t",
      "create table public.t (id int)",
    ]);
    expect(before(o, "create table public.t", "create schema app")).toBe(true);
  });
});

describe("#650 / CLI-3267 SET search_path is reordered freely", () => {
  test.failing(
    "SET search_path is not hoisted above other inputs",
    async () => {
      const o = await order([
        "create table t (id int)",
        "create schema app",
        "set search_path = app",
      ]);
      expect(before(o, "create table t", "set search_path")).toBe(true);
    },
  );

  test.failing(
    "unqualified names after SET search_path resolve in that schema",
    async () => {
      const sql = [
        "create view app.v as select * from app.t",
        "create schema app",
        "set search_path = app; create table t (id int);",
      ];
      expect(await codes(sql, "UNRESOLVED_DEPENDENCY")).toEqual([]);
    },
  );
});

describe("#651 / CLI-3268 CREATE TABLE (LIKE t1) does not depend on t1", () => {
  test.failing("LIKE source orders first", async () => {
    const o = await order([
      "create table public.t2 (like public.t1)",
      "create table public.t1 (a int)",
    ]);
    expect(before(o, "public.t1 (a int)", "like public.t1")).toBe(true);
  });
});

describe("#652 / CLI-3269 partition and EXCLUDE expressions are not walked", () => {
  test.failing("partition key expression depends on the function", async () => {
    const o = await order([
      "create table public.t (c int) partition by range (public.k(c))",
      fnK,
    ]);
    expect(before(o, "function public.k", "partition by")).toBe(true);
  });

  test.failing(
    "EXCLUDE element expression depends on the function",
    async () => {
      const o = await order([
        "create table public.t (a int, exclude using btree (public.k(a) with =))",
        fnK,
      ]);
      expect(before(o, "function public.k", "exclude")).toBe(true);
    },
  );

  test.failing("EXCLUDE WHERE predicate depends on the function", async () => {
    const o = await order([
      "create table public.t (a int, exclude using btree (a with =) where (public.p(a)))",
      fnP,
    ]);
    expect(before(o, "function public.p", "exclude")).toBe(true);
  });

  test.failing(
    "partition bound expression depends on the function",
    async () => {
      const o = await order([
        "create table public.p1 partition of public.p for values in (public.k(1))",
        "create table public.p (c int) partition by list (c)",
        fnK,
      ]);
      expect(before(o, "function public.k", "partition of")).toBe(true);
    },
  );
});

// These edges are right today only because the producer's statement class
// sorts first; a `-- pg-topo:phase` annotation breaks them.
describe("#653 / CLI-3270 edges only the default phase order covers", () => {
  test.failing("CREATE DOMAIN requires its schema", async () => {
    const r = await requiresOf(
      ["create domain s.d as int", "create schema s"],
      "domain",
    );
    expect(r).toContain("schema:.s");
  });

  test.failing("column COLLATE requires the collation", async () => {
    const r = await requiresOf(
      [
        "create table public.t (c text collate public.c1)",
        'create collation public.c1 from "C"',
      ],
      "table",
    );
    expect(r).toContain("collation:public.c1");
  });

  test.failing("COMMENT ON COLUMN requires the table", async () => {
    const r = await requiresOf(
      [
        "comment on column public.t.id is 'x'",
        "create table public.t (id int)",
      ],
      "comment",
    );
    expect(r).toContain("table:public.t");
  });

  test.failing("COMMENT ON TYPE requires the type", async () => {
    const r = await requiresOf(
      ["comment on type public.e is 'x'", "create type public.e as enum ('a')"],
      "comment",
    );
    expect(r.some((x) => x.endsWith("public.e"))).toBe(true);
  });

  test.failing("COMMENT ON DOMAIN requires the domain", async () => {
    const r = await requiresOf(
      ["comment on domain public.d is 'x'", "create domain public.d as int"],
      "comment",
    );
    expect(r.some((x) => x.endsWith("public.d"))).toBe(true);
  });

  test.failing("CAST(x AS type) in a view requires the type", async () => {
    const r = await requiresOf(
      [
        "create view public.v as select cast(1 as public.dd) as x",
        "create domain public.dd as int",
      ],
      "view",
    );
    expect(r.some((x) => x.endsWith("public.dd"))).toBe(true);
  });

  test.failing(
    "CREATE INDEX expression and WHERE calls require the functions",
    async () => {
      const r = await requiresOf(
        [
          "create index ix on public.t ((public.k(c))) where public.p(c)",
          "create table public.t (c int)",
          fnK,
          fnP,
        ],
        "index",
      );
      expect(r).toEqual(
        expect.arrayContaining(["function:public.k", "function:public.p"]),
      );
    },
  );

  test.failing("typed table requires its type", async () => {
    const r = await requiresOf(
      [
        "create table public.tt of public.ct",
        "create type public.ct as (a int)",
      ],
      "of public.ct",
    );
    expect(r).toContain("type:public.ct");
  });

  test.failing("trigger WHEN calls require the function", async () => {
    const r = await requiresOf(
      [
        "create trigger tr before insert on public.t for each row when (public.p(new.a)) execute function public.tf()",
        "create table public.t (a int)",
        "create function public.p(int) returns bool language sql as 'select true'",
        "create function public.tf() returns trigger language plpgsql as $$ begin return new; end $$",
      ],
      "trigger",
    );
    expect(r.some((x) => x.startsWith("function:public.p"))).toBe(true);
  });

  test.failing("COMMENT ON CONSTRAINT requires something", async () => {
    const r = await requiresOf(
      [
        "comment on constraint c1 on public.t is 'x'",
        "alter table public.t add constraint c1 check (a > 0)",
        "create table public.t (a int)",
      ],
      "comment",
    );
    expect(r.length).toBeGreaterThan(0);
  });

  test.failing("rule action requires the table it writes", async () => {
    const r = await requiresOf(
      [
        "create rule r as on insert to public.v do instead insert into public.t default values",
        "create view public.v as select 1 as x",
        "create table public.t (a int)",
      ],
      "rule",
    );
    expect(r).toContain("table:public.t");
  });

  test.failing(
    "nextval('s') without ::regclass requires the sequence",
    async () => {
      const r = await requiresOf(
        [
          "create table public.t (c int8 default nextval('public.seq1'))",
          "create sequence public.seq1",
        ],
        "create table",
      );
      expect(r).toContain("sequence:public.seq1");
    },
  );
});

describe("#654 / CLI-3271 type casts in views and SQL bodies are not dependencies", () => {
  const base = "create view public.base as select 1 as x";

  test.failing("cast to a view row type in a view", async () => {
    const o = await order([
      "create view public.top as select null::public.base as r",
      base,
    ]);
    expect(before(o, "public.base as", "public.top")).toBe(true);
  });

  test.failing("cast to a view row type in a SQL function body", async () => {
    const o = await order([
      "create function public.f() returns int language sql as 'select (null::public.base).x'",
      base,
    ]);
    expect(before(o, "public.base as", "function public.f")).toBe(true);
  });
});

describe("#655 / CLI-3272 function DEFAULT arguments are not dependencies", () => {
  test.failing(
    "DEFAULT argument depends on the function it calls",
    async () => {
      const o = await order([
        "create function public.f2(a int default public.f1()) returns int language sql as 'select a'",
        "create function public.f1() returns int language sql as 'select 1'",
      ]);
      expect(before(o, "public.f1()", "public.f2")).toBe(true);
    },
  );
});

describe("#656 / CLI-3273 ALTER TABLE forms naming an index do not depend on it", () => {
  const t = "create table public.t (a int primary key, b int)";
  const ix = "create unique index tbu on public.t (b)";

  for (const alter of [
    "alter table public.t add constraint tb unique using index tbu",
    "alter table public.t replica identity using index tbu",
    "alter table public.t cluster on tbu",
  ]) {
    test.failing(alter, async () => {
      const o = await order([alter, ix, t]);
      expect(before(o, "create unique index", alter)).toBe(true);
    });
  }
});

describe("#657 / CLI-3274 implicitly created objects are never provided", () => {
  test.failing("identity sequence is provided by its table", async () => {
    const o = await order([
      "alter sequence public.t_id_seq restart with 5",
      "create table public.t (id int generated always as identity)",
    ]);
    expect(before(o, "create table", "alter sequence")).toBe(true);
  });

  test.failing("array type is provided by its table", async () => {
    const o = await order([
      "create table public.c (xs public._t)",
      "create table public.t (id int)",
    ]);
    expect(before(o, "public.t (id", "public.c")).toBe(true);
  });
});

describe("#658 / CLI-3275 DO blocks are hoisted and scanned with a regex", () => {
  test.failing(
    "DO block is not hoisted above the table its body uses",
    async () => {
      const o = await order([
        "do $$ begin if not exists (select 1 from pg_policies where policyname = 'p') then create policy p on public.t using (true); end if; end $$",
        "create table public.t (a int)",
      ]);
      expect(before(o, "create table", "do $$")).toBe(true);
    },
  );

  test.failing("quoted enum created in a DO body is provided", async () => {
    const sql = [
      'create table public.c (s public."MyEnum")',
      `do $$ begin create type public."MyEnum" as enum ('a'); end $$`,
    ];
    expect(await codes(sql, "UNRESOLVED_DEPENDENCY")).toEqual([]);
  });

  test.failing(
    "unqualified enum created in a DO body is provided",
    async () => {
      const sql = [
        "create table public.c (s mood)",
        "do $$ begin create type mood as enum ('a'); end $$",
      ];
      expect(await codes(sql, "UNRESOLVED_DEPENDENCY")).toEqual([]);
    },
  );

  test.failing(
    "commented-out CREATE TYPE in a DO body is not a producer",
    async () => {
      const sql = [
        "create type public.mood as enum ('a')",
        "do $$ begin -- create type public.mood as enum ('x')\n perform 1; end $$",
      ];
      expect(await codes(sql, "DUPLICATE_PRODUCER")).toEqual([]);
    },
  );
});

describe("#660 / CLI-3277 unsupported statements sort before functions, views and indexes", () => {
  test.failing(
    "ALTER FUNCTION ... SET stays after CREATE FUNCTION",
    async () => {
      const o = await order([
        "create function public.f() returns int language sql as 'select 1'",
        "alter function public.f() set search_path = ''",
      ]);
      expect(before(o, "create function", "alter function")).toBe(true);
    },
  );
});

describe("#661 / CLI-3278 source-order tie-break compares <input:N> as strings", () => {
  test.failing("<input:2> stays before <input:10>", async () => {
    const sql = Array.from(
      { length: 11 },
      (_, i) => `create table public.t${i} (a int)`,
    );
    const o = await order(sql);
    expect(o).toEqual(sql);
  });
});

describe("#662 / CLI-3279 requires annotation signatures", () => {
  test.failing("quoted type in the signature resolves", async () => {
    const sql = [
      '-- pg-topo:requires function:public.f(public."My Type")\ncreate view public.v as select 1',
      'create type public."My Type" as (a int)',
      "create function public.f(x public.\"My Type\") returns int language sql as 'select 1'",
    ];
    expect(await codes(sql, "UNRESOLVED_DEPENDENCY")).toEqual([]);
  });

  for (const spelled of ["decimal", "numeric(10,2)"]) {
    test.failing(`${spelled} matches a numeric parameter`, async () => {
      const sql = [
        `-- pg-topo:requires function:public.f(${spelled})\ncreate view public.v as select 1`,
        "create function public.f(a numeric) returns int language sql as 'select 1'",
      ];
      expect(await codes(sql, "UNRESOLVED_DEPENDENCY")).toEqual([]);
    });
  }
});

describe("#663 / CLI-3280 call argument types are inferred from literals and matched exactly", () => {
  for (const [label, callee, call] of [
    [
      "implicit cast (int literal to bigint)",
      "create function public.g(a bigint) returns int language sql as 'select 1'",
      "public.g(1)",
    ],
    [
      "domain parameter",
      "create function public.g(a public.d) returns int language sql as 'select 1'",
      "public.g(1)",
    ],
  ] as const) {
    test.failing(label, async () => {
      const o = await order([
        `create function public.caller() returns int language sql as $q$ select ${call} $q$`,
        "create domain public.d as int",
        callee,
      ]);
      expect(before(o, "function public.g", "public.caller")).toBe(true);
    });
  }
});

describe("#664 / CLI-3281 unqualified references in SQL function bodies are ignored", () => {
  test.failing("unqualified function call", async () => {
    const o = await order([
      "create function public.c() returns int language sql as $q$ select g(1) $q$",
      "create function public.g(a int) returns int language sql as 'select 1'",
    ]);
    expect(before(o, "public.g(a int)", "public.c()")).toBe(true);
  });

  test.failing("unqualified relation", async () => {
    const o = await order([
      "create function public.n() returns bigint language sql as $q$ select count(*) from v $q$",
      "create view public.v as select 1 as x",
    ]);
    expect(before(o, "create view", "public.n()")).toBe(true);
  });
});

describe("#665 / CLI-3282 empty input and unreadable files", () => {
  const fixtures = createTempFixtureHarness("pg-topo-665-");
  afterAll(fixtures.cleanup);

  test.failing("empty input is not a PARSE_ERROR", async () => {
    expect(await codes(["", "create table public.t (a int)"])).toEqual([]);
  });

  test.failing("unreadable file is a diagnostic, not a throw", async () => {
    const dir = await fixtures.createSqlFixture({
      "a.sql": "create table public.t (a int);",
      "b.sql": "create table public.u (a int);",
    });
    const unreadable = path.join(dir, "b.sql");
    await chmod(unreadable, 0o000);
    try {
      const r = await analyzeAndSortFromFiles([dir]);
      expect(r.diagnostics.map((d) => d.code)).toEqual(["DISCOVERY_ERROR"]);
    } finally {
      await chmod(unreadable, 0o644);
    }
  });
});

describe("#666 / CLI-3283 PG18 syntax and per-input parse failures", () => {
  const sql = [
    "create table public.a (x int);\ncreate table public.t (a int, b int generated always as (a * 2) virtual);\ncreate table public.z (y int);",
  ];

  test.failing("virtual generated column parses", async () => {
    expect(await codes(sql, "PARSE_ERROR")).toEqual([]);
  });

  test.failing("one bad statement does not drop its whole input", async () => {
    expect((await analyzeAndSort(sql)).ordered.length).toBe(3);
  });
});

describe("#667 / CLI-3284 ALTER SEQUENCE OWNER TO sorts after OWNED BY", () => {
  // pg_dump order: once linked, a sequence's owner can only change through its table.
  test.failing("OWNER TO stays before OWNED BY", async () => {
    const o = await order([
      "create table app.t (id int)",
      "create sequence app.s",
      "alter sequence app.s owner to r1",
      "alter sequence app.s owned by app.t.id",
      "alter table app.t owner to r1",
      "create schema app",
    ]);
    expect(before(o, "owner to r1", "owned by")).toBe(true);
  });
});

describe("#668 / CLI-3285 primary key and unique index on the same columns", () => {
  test.failing("not reported as DUPLICATE_PRODUCER", async () => {
    const sql = [
      "create table public.t (id int)",
      "alter table only public.t add constraint t_pkey primary key (id)",
      "create unique index t_ux on public.t (id)",
    ];
    expect(await codes(sql)).toEqual([]);
  });

  test.failing(
    "duplicate key producer does not drag an FK ALTER past later readers",
    async () => {
      const o = await order([
        "create materialized view public.mv as select c3 from public.t1",
        "create unique index ux on public.t1 (c1)",
        "alter table public.t1 add column c3 date references public.t1 (c1)",
        "create table public.t1 (c1 date primary key)",
      ]);
      expect(before(o, "add column c3", "materialized view")).toBe(true);
    },
  );
});

describe("#669 / CLI-3286 ALTER EVENT TRIGGER OWNER TO", () => {
  test.failing("resolves the schema-less event trigger", async () => {
    const sql = [
      "alter event trigger e owner to postgres",
      "create event trigger e on ddl_command_end execute function public.f()",
      "create function public.f() returns event_trigger language plpgsql as $$ begin end $$",
    ];
    expect(await codes(sql, "UNRESOLVED_DEPENDENCY")).toEqual([]);
  });
});

describe("#670 / CLI-3287 CREATE RECURSIVE VIEW", () => {
  test.failing("does not report itself as unresolved", async () => {
    expect(
      await codes([
        "create recursive view public.rv (n) as select 1 union all select n + 1 from rv where n < 3",
      ]),
    ).toEqual([]);
  });
});

describe("#671 / CLI-3288 SELECT ... INTO", () => {
  test.failing("provides the table it creates", async () => {
    const o = await order([
      "create view public.w as select * from public.newt",
      "select 1 as x into public.newt",
    ]);
    expect(before(o, "into public.newt", "create view")).toBe(true);
  });
});

describe("#672 / CLI-3289 CREATE FOREIGN DATA WRAPPER ... HANDLER", () => {
  test.failing("depends on the handler function", async () => {
    const o = await order([
      "create foreign data wrapper w handler public.h",
      "create function public.h() returns fdw_handler language c as 'x'",
    ]);
    expect(before(o, "function public.h", "foreign data wrapper")).toBe(true);
  });
});

describe("#673 / CLI-3290 subscriptions require a local publication", () => {
  test.failing("subscription publication is remote", async () => {
    expect(
      await codes([
        "create subscription sb connection 'dbname=x' publication pb with (connect = false)",
      ]),
    ).toEqual([]);
  });
});

describe("#674 / CLI-3291 externalProviders function entries", () => {
  test.failing("signature-less provider satisfies a call", async () => {
    const r = await analyzeAndSort(
      ["create view public.v as select ext.f(1, 2)"],
      {
        externalProviders: [
          { kind: "schema", name: "ext" },
          { kind: "function", schema: "ext", name: "f" },
        ],
      },
    );
    expect(
      r.diagnostics.filter((d) => d.code === "UNRESOLVED_DEPENDENCY"),
    ).toEqual([]);
  });
});
