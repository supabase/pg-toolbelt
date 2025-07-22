import type { Collation } from "./models/collation.ts";
import type { CompositeType } from "./models/composite-type.ts";
import type { Domain } from "./models/domain.ts";
import type { Enum } from "./models/enum.ts";
import type { Extension } from "./models/extension.ts";
import type { Index } from "./models/index.ts";
import type { Procedure } from "./models/procedure.ts";
import type { Role } from "./models/role.ts";
import type { Schema } from "./models/schema.ts";
import type { Sequence } from "./models/sequence.ts";
import type { Table } from "./models/table.ts";
import type { Trigger } from "./models/trigger.ts";
import type { Type } from "./models/type.ts";
import type { View } from "./models/view.ts";

interface CatalogProps {
  collations: Collation[];
  compositeTypes: CompositeType[];
  domains: Domain[];
  enums: Enum[];
  extensions: Extension[];
  procedures: Procedure[];
  indexes: Index[];
  roles: Role[];
  schemas: Schema[];
  sequences: Sequence[];
  tables: Table[];
  triggers: Trigger[];
  types: Type[];
  views: View[];
}

export class Catalog {
  public readonly collations: CatalogProps["collations"];
  public readonly compositeTypes: CatalogProps["compositeTypes"];
  public readonly domains: CatalogProps["domains"];
  public readonly enums: CatalogProps["enums"];
  public readonly extensions: CatalogProps["extensions"];
  public readonly procedures: CatalogProps["procedures"];
  public readonly indexes: CatalogProps["indexes"];
  public readonly roles: CatalogProps["roles"];
  public readonly schemas: CatalogProps["schemas"];
  public readonly sequences: CatalogProps["sequences"];
  public readonly tables: CatalogProps["tables"];
  public readonly triggers: CatalogProps["triggers"];
  public readonly types: CatalogProps["types"];
  public readonly views: CatalogProps["views"];

  constructor(props: CatalogProps) {
    this.collations = props.collations;
    this.compositeTypes = props.compositeTypes;
    this.domains = props.domains;
    this.enums = props.enums;
    this.extensions = props.extensions;
    this.procedures = props.procedures;
    this.indexes = props.indexes;
    this.roles = props.roles;
    this.schemas = props.schemas;
    this.sequences = props.sequences;
    this.tables = props.tables;
    this.triggers = props.triggers;
    this.types = props.types;
    this.views = props.views;
  }
}
