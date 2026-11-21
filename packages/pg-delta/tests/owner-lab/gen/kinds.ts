/**
 * Object-kind library for the owner-lab scenario generator.
 *
 * Every kind knows how to emit its CREATE (applier-owned), a kind-appropriate
 * modification (`c.mod`), the `ALTER ... OWNER TO`, and its privilege forms.
 * `support` holds companions that exist whether or not the main object does
 * (base tables, an aggregate's sfunc), so a transition only varies the object.
 */

export type KindId =
  | "table"
  | "table-rls"
  | "serial"
  | "identity"
  | "partitioned"
  | "view"
  | "matview"
  | "function"
  | "procedure"
  | "aggregate"
  | "sequence"
  | "composite"
  | "enum"
  | "domain"
  | "schema"
  | "publication";

export interface ObjCtx {
  /** schema name (`s` or `public`) */
  S: string;
  /** object name */
  n: string;
  /** emit the modified variant */
  mod: boolean;
}

export interface Priv {
  revokePublic?(c: ObjCtx): string[];
  /** grant the kind's characteristic privilege */
  grant(c: ObjCtx, grantee: string, grantOption: boolean): string[];
}

export interface Kind {
  id: KindId;
  short: string;
  support?(c: ObjCtx): string[];
  create(c: ObjCtx): string[];
  move(c: ObjCtx, role: string): string[];
  priv?: Priv;
}

const wgo = (o: boolean): string => (o ? " WITH GRANT OPTION" : "");
const note = (c: ObjCtx): string => (c.mod ? ", note text" : "");

const tableLike = (
  id: KindId,
  short: string,
  ddl: (c: ObjCtx) => string[],
  extraGrant?: (c: ObjCtx, g: string, o: boolean) => string[],
): Kind => ({
  id,
  short,
  create: ddl,
  move: (c, r) => [`ALTER TABLE ${c.S}.${c.n} OWNER TO ${r};`],
  priv: {
    grant: (c, g, o) => [
      `GRANT SELECT ON TABLE ${c.S}.${c.n} TO ${g}${wgo(o)};`,
      ...(extraGrant?.(c, g, o) ?? []),
    ],
  },
});

const seqGrant = (c: ObjCtx, g: string, o: boolean): string[] => [
  `GRANT USAGE ON SEQUENCE ${c.S}.${c.n}_id_seq TO ${g}${wgo(o)};`,
];

const FN_SIG = "(int)";

export const KINDS: Kind[] = [
  tableLike("table", "tbl", (c) => [
    `CREATE TABLE ${c.S}.${c.n} (id int PRIMARY KEY, v text${note(c)});`,
    `CREATE INDEX ${c.n}_v_idx ON ${c.S}.${c.n} (v);`,
  ]),
  {
    id: "table-rls",
    short: "rls",
    create: (c) => [
      `CREATE TABLE ${c.S}.${c.n} (id int PRIMARY KEY, uid int${note(c)});`,
      `ALTER TABLE ${c.S}.${c.n} ENABLE ROW LEVEL SECURITY;`,
      `CREATE POLICY ${c.n}_read ON ${c.S}.${c.n} FOR SELECT TO reader USING (${c.mod ? "uid IS NOT NULL" : "true"});`,
      `CREATE FUNCTION ${c.S}.${c.n}_trg() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;`,
      `CREATE TRIGGER ${c.n}_trg BEFORE INSERT ON ${c.S}.${c.n} FOR EACH ROW EXECUTE FUNCTION ${c.S}.${c.n}_trg();`,
    ],
    move: (c, r) => [
      `ALTER TABLE ${c.S}.${c.n} OWNER TO ${r};`,
      `ALTER FUNCTION ${c.S}.${c.n}_trg() OWNER TO ${r};`,
    ],
    priv: {
      grant: (c, g, o) => [
        `GRANT SELECT ON TABLE ${c.S}.${c.n} TO ${g}${wgo(o)};`,
      ],
    },
  },
  tableLike(
    "serial",
    "ser",
    (c) => [
      `CREATE TABLE ${c.S}.${c.n} (id bigserial PRIMARY KEY, v text${note(c)});`,
    ],
    seqGrant,
  ),
  tableLike(
    "identity",
    "idn",
    (c) => [
      `CREATE TABLE ${c.S}.${c.n} (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, v text${note(c)});`,
    ],
    seqGrant,
  ),
  {
    id: "partitioned",
    short: "part",
    create: (c) => [
      `CREATE TABLE ${c.S}.${c.n} (id int, ts date NOT NULL${note(c)}) PARTITION BY RANGE (ts);`,
      `CREATE TABLE ${c.S}.${c.n}_p1 PARTITION OF ${c.S}.${c.n} FOR VALUES FROM ('2020-01-01') TO ('2021-01-01');`,
    ],
    move: (c, r) => [
      `ALTER TABLE ${c.S}.${c.n} OWNER TO ${r};`,
      `ALTER TABLE ${c.S}.${c.n}_p1 OWNER TO ${r};`,
    ],
    priv: {
      grant: (c, g, o) => [
        `GRANT SELECT ON TABLE ${c.S}.${c.n} TO ${g}${wgo(o)};`,
        `GRANT SELECT ON TABLE ${c.S}.${c.n}_p1 TO ${g}${wgo(o)};`,
      ],
    },
  },
  ...(["view", "matview"] as const).map((id): Kind => {
    const mat = id === "matview";
    const word = mat ? "MATERIALIZED VIEW" : "VIEW";
    return {
      id,
      short: mat ? "mv" : "view",
      support: (c) => [`CREATE TABLE ${c.S}.${c.n}_base (id int, v text);`],
      create: (c) => [
        `CREATE ${word} ${c.S}.${c.n} AS SELECT id, v${c.mod ? ", upper(v) AS vu" : ""} FROM ${c.S}.${c.n}_base;`,
      ],
      move: (c, r) => [`ALTER ${word} ${c.S}.${c.n} OWNER TO ${r};`],
      priv: {
        grant: (c, g, o) => [
          `GRANT SELECT ON TABLE ${c.S}.${c.n} TO ${g}${wgo(o)};`,
        ],
      },
    };
  }),
  ...(["function", "procedure"] as const).map((id): Kind => {
    const proc = id === "procedure";
    const word = proc ? "PROCEDURE" : "FUNCTION";
    return {
      id,
      short: proc ? "proc" : "fn",
      create: (c) => [
        proc
          ? `CREATE PROCEDURE ${c.S}.${c.n}(x int) LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT x + ${c.mod ? 2 : 1} $$;`
          : `CREATE FUNCTION ${c.S}.${c.n}(x int) RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT x + ${c.mod ? 2 : 1} $$;`,
      ],
      move: (c, r) => [`ALTER ${word} ${c.S}.${c.n}${FN_SIG} OWNER TO ${r};`],
      priv: {
        revokePublic: (c) => [
          `REVOKE ALL ON ${word} ${c.S}.${c.n}${FN_SIG} FROM PUBLIC;`,
        ],
        grant: (c, g, o) => [
          `GRANT EXECUTE ON ${word} ${c.S}.${c.n}${FN_SIG} TO ${g}${wgo(o)};`,
        ],
      },
    };
  }),
  {
    id: "aggregate",
    short: "agg",
    support: (c) => [
      `CREATE FUNCTION ${c.S}.${c.n}_sfunc(int, int) RETURNS int LANGUAGE sql IMMUTABLE AS $$ SELECT $1 + $2 $$;`,
    ],
    create: (c) => [
      `CREATE AGGREGATE ${c.S}.${c.n}(int) (SFUNC = ${c.S}.${c.n}_sfunc, STYPE = int, INITCOND = '${c.mod ? 1 : 0}');`,
    ],
    move: (c, r) => [`ALTER AGGREGATE ${c.S}.${c.n}${FN_SIG} OWNER TO ${r};`],
    priv: {
      revokePublic: (c) => [
        `REVOKE ALL ON ROUTINE ${c.S}.${c.n}${FN_SIG} FROM PUBLIC;`,
      ],
      grant: (c, g, o) => [
        `GRANT EXECUTE ON ROUTINE ${c.S}.${c.n}${FN_SIG} TO ${g}${wgo(o)};`,
      ],
    },
  },
  {
    id: "sequence",
    short: "seq",
    create: (c) => [
      `CREATE SEQUENCE ${c.S}.${c.n}${c.mod ? " INCREMENT BY 2" : ""};`,
    ],
    move: (c, r) => [`ALTER SEQUENCE ${c.S}.${c.n} OWNER TO ${r};`],
    priv: {
      grant: (c, g, o) => [
        `GRANT USAGE ON SEQUENCE ${c.S}.${c.n} TO ${g}${wgo(o)};`,
      ],
    },
  },
  {
    id: "composite",
    short: "comp",
    create: (c) => [
      `CREATE TYPE ${c.S}.${c.n} AS (a int, b int${c.mod ? ", c int" : ""});`,
    ],
    move: (c, r) => [`ALTER TYPE ${c.S}.${c.n} OWNER TO ${r};`],
    priv: {
      revokePublic: (c) => [`REVOKE USAGE ON TYPE ${c.S}.${c.n} FROM PUBLIC;`],
      grant: (c, g, o) => [
        `GRANT USAGE ON TYPE ${c.S}.${c.n} TO ${g}${wgo(o)};`,
      ],
    },
  },
  {
    id: "enum",
    short: "enum",
    create: (c) => [
      `CREATE TYPE ${c.S}.${c.n} AS ENUM ('a', 'b'${c.mod ? ", 'c'" : ""});`,
    ],
    move: (c, r) => [`ALTER TYPE ${c.S}.${c.n} OWNER TO ${r};`],
    priv: {
      revokePublic: (c) => [`REVOKE USAGE ON TYPE ${c.S}.${c.n} FROM PUBLIC;`],
      grant: (c, g, o) => [
        `GRANT USAGE ON TYPE ${c.S}.${c.n} TO ${g}${wgo(o)};`,
      ],
    },
  },
  {
    id: "domain",
    short: "dom",
    create: (c) => [
      `CREATE DOMAIN ${c.S}.${c.n} AS int CHECK (VALUE ${c.mod ? ">= 0" : "> 0"});`,
    ],
    move: (c, r) => [`ALTER DOMAIN ${c.S}.${c.n} OWNER TO ${r};`],
    priv: {
      revokePublic: (c) => [
        `REVOKE USAGE ON DOMAIN ${c.S}.${c.n} FROM PUBLIC;`,
      ],
      grant: (c, g, o) => [
        `GRANT USAGE ON DOMAIN ${c.S}.${c.n} TO ${g}${wgo(o)};`,
      ],
    },
  },
  {
    // The schema is the object (c.S is its name; c.n is unused).
    id: "schema",
    short: "sch",
    create: (c) => [
      `CREATE SCHEMA ${c.S};`,
      `CREATE TABLE ${c.S}.t (id int);`,
      ...(c.mod ? [`CREATE TABLE ${c.S}.t2 (id int);`] : []),
    ],
    move: (c, r) => [`ALTER SCHEMA ${c.S} OWNER TO ${r};`],
    priv: {
      grant: (c, g, o) => [`GRANT USAGE ON SCHEMA ${c.S} TO ${g}${wgo(o)};`],
    },
  },
  {
    id: "publication",
    short: "pub",
    support: (c) => [
      `CREATE TABLE ${c.S}.${c.n}_t (id int PRIMARY KEY);`,
      `CREATE TABLE ${c.S}.${c.n}_t2 (id int PRIMARY KEY);`,
    ],
    create: (c) => [
      `CREATE PUBLICATION pub_${c.n} FOR TABLE ${c.S}.${c.n}_t${c.mod ? `, ${c.S}.${c.n}_t2` : ""};`,
    ],
    move: (c, r) => [`ALTER PUBLICATION pub_${c.n} OWNER TO ${r};`],
  },
];

export const KIND_BY_ID = new Map(KINDS.map((k) => [k.id, k]));
