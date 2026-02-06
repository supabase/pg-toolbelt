import { describe, expect, test } from "vitest";
import {
  type ChangeCase,
  collation,
  eventTrigger,
  extension,
  formatCases,
  language,
  pgVersion,
  priv,
  renderChanges,
} from "./fixtures.ts";
import { CreateExtension } from "../../../src/core/objects/extension/changes/extension.create.ts";
import {
  AlterExtensionSetSchema,
  AlterExtensionUpdateVersion,
} from "../../../src/core/objects/extension/changes/extension.alter.ts";
import {
  CreateCommentOnExtension,
  DropCommentOnExtension,
} from "../../../src/core/objects/extension/changes/extension.comment.ts";
import { DropExtension } from "../../../src/core/objects/extension/changes/extension.drop.ts";
import { CreateLanguage } from "../../../src/core/objects/language/changes/language.create.ts";
import { AlterLanguageChangeOwner } from "../../../src/core/objects/language/changes/language.alter.ts";
import {
  CreateCommentOnLanguage,
  DropCommentOnLanguage,
} from "../../../src/core/objects/language/changes/language.comment.ts";
import { DropLanguage } from "../../../src/core/objects/language/changes/language.drop.ts";
import {
  GrantLanguagePrivileges,
  RevokeLanguagePrivileges,
  RevokeGrantOptionLanguagePrivileges,
} from "../../../src/core/objects/language/changes/language.privilege.ts";
import { CreateEventTrigger } from "../../../src/core/objects/event-trigger/changes/event-trigger.create.ts";
import {
  AlterEventTriggerChangeOwner,
  AlterEventTriggerSetEnabled,
} from "../../../src/core/objects/event-trigger/changes/event-trigger.alter.ts";
import {
  CreateCommentOnEventTrigger,
  DropCommentOnEventTrigger,
} from "../../../src/core/objects/event-trigger/changes/event-trigger.comment.ts";
import { DropEventTrigger } from "../../../src/core/objects/event-trigger/changes/event-trigger.drop.ts";
import { CreateCollation } from "../../../src/core/objects/collation/changes/collation.create.ts";
import {
  AlterCollationChangeOwner,
  AlterCollationRefreshVersion,
} from "../../../src/core/objects/collation/changes/collation.alter.ts";
import {
  CreateCommentOnCollation,
  DropCommentOnCollation,
} from "../../../src/core/objects/collation/changes/collation.comment.ts";
import { DropCollation } from "../../../src/core/objects/collation/changes/collation.drop.ts";

const changes: ChangeCase[] = [
  { label: "extension.create", change: new CreateExtension({ extension }) },
  {
    label: "extension.alter.set_schema",
    change: new AlterExtensionSetSchema({ extension, schema: "extensions" }),
  },
  {
    label: "extension.alter.update_version",
    change: new AlterExtensionUpdateVersion({ extension, version: "1.1" }),
  },
  {
    label: "extension.comment.create",
    change: new CreateCommentOnExtension({ extension }),
  },
  {
    label: "extension.comment.drop",
    change: new DropCommentOnExtension({ extension }),
  },
  { label: "extension.drop", change: new DropExtension({ extension }) },

  { label: "language.create", change: new CreateLanguage({ language }) },
  {
    label: "language.alter.owner",
    change: new AlterLanguageChangeOwner({ language, owner: "owner2" }),
  },
  {
    label: "language.comment.create",
    change: new CreateCommentOnLanguage({ language }),
  },
  { label: "language.comment.drop", change: new DropCommentOnLanguage({ language }) },
  {
    label: "language.privilege.grant",
    change: new GrantLanguagePrivileges({
      language,
      grantee: "app_user",
      privileges: [priv("USAGE")],
      version: pgVersion,
    }),
  },
  {
    label: "language.privilege.revoke",
    change: new RevokeLanguagePrivileges({
      language,
      grantee: "app_user",
      privileges: [priv("USAGE")],
      version: pgVersion,
    }),
  },
  {
    label: "language.privilege.revoke_grant_option",
    change: new RevokeGrantOptionLanguagePrivileges({
      language,
      grantee: "app_user",
      privilegeNames: ["USAGE"],
      version: pgVersion,
    }),
  },
  { label: "language.drop", change: new DropLanguage({ language }) },

  { label: "event_trigger.create", change: new CreateEventTrigger({ eventTrigger }) },
  {
    label: "event_trigger.alter.owner",
    change: new AlterEventTriggerChangeOwner({
      eventTrigger,
      owner: "owner2",
    }),
  },
  {
    label: "event_trigger.alter.enabled",
    change: new AlterEventTriggerSetEnabled({
      eventTrigger,
      enabled: "R",
    }),
  },
  {
    label: "event_trigger.comment.create",
    change: new CreateCommentOnEventTrigger({ eventTrigger }),
  },
  {
    label: "event_trigger.comment.drop",
    change: new DropCommentOnEventTrigger({ eventTrigger }),
  },
  { label: "event_trigger.drop", change: new DropEventTrigger({ eventTrigger }) },

  { label: "collation.create", change: new CreateCollation({ collation }) },
  {
    label: "collation.alter.owner",
    change: new AlterCollationChangeOwner({ collation, owner: "owner2" }),
  },
  {
    label: "collation.alter.refresh_version",
    change: new AlterCollationRefreshVersion({ collation }),
  },
  {
    label: "collation.comment.create",
    change: new CreateCommentOnCollation({ collation }),
  },
  {
    label: "collation.comment.drop",
    change: new DropCommentOnCollation({ collation }),
  },
  { label: "collation.drop", change: new DropCollation({ collation }) },
];

describe("format options: extension + language + event trigger + collation", () => {
  const [formatOff, formatPrettyUpper, formatPrettyLowerLeading, formatPrettyNarrow, formatPrettyPreserve] =
    formatCases;

  test(formatOff.header, () => {
    const output = `${formatOff.header}\n\n${renderChanges(
      changes,
      formatOff.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: off

      -- extension.create
      CREATE EXTENSION test_extension WITH SCHEMA public

      -- extension.alter.set_schema
      ALTER EXTENSION test_extension SET SCHEMA extensions

      -- extension.alter.update_version
      ALTER EXTENSION test_extension UPDATE TO '1.1'

      -- extension.comment.create
      COMMENT ON EXTENSION test_extension IS 'extension comment'

      -- extension.comment.drop
      COMMENT ON EXTENSION test_extension IS NULL

      -- extension.drop
      DROP EXTENSION test_extension

      -- language.create
      CREATE TRUSTED LANGUAGE plpgsql HANDLER plpgsql_call_handler INLINE plpgsql_inline_handler VALIDATOR plpgsql_validator

      -- language.alter.owner
      ALTER LANGUAGE plpgsql OWNER TO owner2

      -- language.comment.create
      COMMENT ON LANGUAGE plpgsql IS 'language comment'

      -- language.comment.drop
      COMMENT ON LANGUAGE plpgsql IS NULL

      -- language.privilege.grant
      GRANT ALL ON LANGUAGE plpgsql TO app_user

      -- language.privilege.revoke
      REVOKE ALL ON LANGUAGE plpgsql FROM app_user

      -- language.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON LANGUAGE plpgsql FROM app_user

      -- language.drop
      DROP LANGUAGE plpgsql

      -- event_trigger.create
      CREATE EVENT TRIGGER ddl_logger ON ddl_command_start WHEN TAG IN ('CREATE TABLE', 'ALTER TABLE') EXECUTE FUNCTION public.log_ddl()

      -- event_trigger.alter.owner
      ALTER EVENT TRIGGER ddl_logger OWNER TO owner2

      -- event_trigger.alter.enabled
      ALTER EVENT TRIGGER ddl_logger ENABLE REPLICA

      -- event_trigger.comment.create
      COMMENT ON EVENT TRIGGER ddl_logger IS 'event trigger comment'

      -- event_trigger.comment.drop
      COMMENT ON EVENT TRIGGER ddl_logger IS NULL

      -- event_trigger.drop
      DROP EVENT TRIGGER ddl_logger

      -- collation.create
      CREATE COLLATION public.test (LOCALE = 'en_US', LC_COLLATE = 'en_US', LC_CTYPE = 'en_US', PROVIDER = icu, DETERMINISTIC = false, RULES = '& A < a <<< à', VERSION = '1.0')

      -- collation.alter.owner
      ALTER COLLATION public.test OWNER TO owner2

      -- collation.alter.refresh_version
      ALTER COLLATION public.test REFRESH VERSION

      -- collation.comment.create
      COMMENT ON COLLATION public.test IS 'collation comment'

      -- collation.comment.drop
      COMMENT ON COLLATION public.test IS NULL

      -- collation.drop
      DROP COLLATION public.test"
    `);
  });

  test(formatPrettyUpper.header, () => {
    const output = `${formatPrettyUpper.header}\n\n${renderChanges(
      changes,
      formatPrettyUpper.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true }

      -- extension.create
      CREATE EXTENSION test_extension
      WITH SCHEMA public

      -- extension.alter.set_schema
      ALTER EXTENSION test_extension SET SCHEMA extensions

      -- extension.alter.update_version
      ALTER EXTENSION test_extension UPDATE TO '1.1'

      -- extension.comment.create
      COMMENT ON EXTENSION test_extension IS 'extension comment'

      -- extension.comment.drop
      COMMENT ON EXTENSION test_extension IS NULL

      -- extension.drop
      DROP EXTENSION test_extension

      -- language.create
      CREATE TRUSTED LANGUAGE plpgsql
      HANDLER plpgsql_call_handler
      INLINE plpgsql_inline_handler
      VALIDATOR plpgsql_validator

      -- language.alter.owner
      ALTER LANGUAGE plpgsql OWNER TO owner2

      -- language.comment.create
      COMMENT ON LANGUAGE plpgsql IS 'language comment'

      -- language.comment.drop
      COMMENT ON LANGUAGE plpgsql IS NULL

      -- language.privilege.grant
      GRANT ALL ON LANGUAGE plpgsql TO app_user

      -- language.privilege.revoke
      REVOKE ALL ON LANGUAGE plpgsql FROM app_user

      -- language.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON LANGUAGE plpgsql FROM app_user

      -- language.drop
      DROP LANGUAGE plpgsql

      -- event_trigger.create
      CREATE EVENT TRIGGER ddl_logger
      ON ddl_command_start
      WHEN TAG IN (
        'CREATE TABLE',
        'ALTER TABLE'
      )
      EXECUTE FUNCTION public.log_ddl()

      -- event_trigger.alter.owner
      ALTER EVENT TRIGGER ddl_logger OWNER TO owner2

      -- event_trigger.alter.enabled
      ALTER EVENT TRIGGER ddl_logger ENABLE REPLICA

      -- event_trigger.comment.create
      COMMENT ON EVENT TRIGGER ddl_logger IS 'event trigger comment'

      -- event_trigger.comment.drop
      COMMENT ON EVENT TRIGGER ddl_logger IS NULL

      -- event_trigger.drop
      DROP EVENT TRIGGER ddl_logger

      -- collation.create
      CREATE COLLATION public.test
      (
        LOCALE = 'en_US',
        LC_COLLATE = 'en_US',
        LC_CTYPE = 'en_US',
        PROVIDER = icu,
        DETERMINISTIC = false,
        RULES = '& A < a <<< à',
        VERSION = '1.0'
      )

      -- collation.alter.owner
      ALTER COLLATION public.test OWNER TO owner2

      -- collation.alter.refresh_version
      ALTER COLLATION public.test REFRESH VERSION

      -- collation.comment.create
      COMMENT ON COLLATION public.test IS 'collation comment'

      -- collation.comment.drop
      COMMENT ON COLLATION public.test IS NULL

      -- collation.drop
      DROP COLLATION public.test"
    `);
  });

  test(formatPrettyLowerLeading.header, () => {
    const output = `${formatPrettyLowerLeading.header}\n\n${renderChanges(
      changes,
      formatPrettyLowerLeading.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, keywordCase: 'lower', commaStyle: 'leading', alignColumns: true, indentWidth: 4 }

      -- extension.create
      create extension test_extension
      with schema public

      -- extension.alter.set_schema
      alter extension test_extension set schema extensions

      -- extension.alter.update_version
      alter extension test_extension update to '1.1'

      -- extension.comment.create
      comment on extension test_extension is 'extension comment'

      -- extension.comment.drop
      comment on extension test_extension is null

      -- extension.drop
      drop extension test_extension

      -- language.create
      create trusted language plpgsql
      handler plpgsql_call_handler
      inline plpgsql_inline_handler
      validator plpgsql_validator

      -- language.alter.owner
      alter language plpgsql owner to owner2

      -- language.comment.create
      comment on language plpgsql is 'language comment'

      -- language.comment.drop
      comment on language plpgsql is null

      -- language.privilege.grant
      grant all on language plpgsql to app_user

      -- language.privilege.revoke
      revoke all on language plpgsql from app_user

      -- language.privilege.revoke_grant_option
      revoke grant option for all on language plpgsql from app_user

      -- language.drop
      drop language plpgsql

      -- event_trigger.create
      create event trigger ddl_logger
      on ddl_command_start
      when tag in (
            'CREATE TABLE'
          , 'ALTER TABLE'
      )
      execute function public.log_ddl()

      -- event_trigger.alter.owner
      alter event trigger ddl_logger owner to owner2

      -- event_trigger.alter.enabled
      alter event trigger ddl_logger enable replica

      -- event_trigger.comment.create
      comment on event trigger ddl_logger is 'event trigger comment'

      -- event_trigger.comment.drop
      comment on event trigger ddl_logger is null

      -- event_trigger.drop
      drop event trigger ddl_logger

      -- collation.create
      create collation public.test
      (
            locale = 'en_US'
          , lc_collate = 'en_US'
          , lc_ctype = 'en_US'
          , provider = icu
          , deterministic = false
          , rules = '& A < a <<< à'
          , version = '1.0'
      )

      -- collation.alter.owner
      alter collation public.test owner to owner2

      -- collation.alter.refresh_version
      alter collation public.test refresh version

      -- collation.comment.create
      comment on collation public.test is 'collation comment'

      -- collation.comment.drop
      comment on collation public.test is null

      -- collation.drop
      drop collation public.test"
    `);
  });

  test(formatPrettyNarrow.header, () => {
    const output = `${formatPrettyNarrow.header}\n\n${renderChanges(
      changes,
      formatPrettyNarrow.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, lineWidth: 40 }

      -- extension.create
      CREATE EXTENSION test_extension
      WITH SCHEMA public

      -- extension.alter.set_schema
      ALTER EXTENSION test_extension SET
        SCHEMA extensions

      -- extension.alter.update_version
      ALTER EXTENSION test_extension UPDATE TO
        '1.1'

      -- extension.comment.create
      COMMENT ON EXTENSION test_extension IS
        'extension comment'

      -- extension.comment.drop
      COMMENT ON EXTENSION test_extension IS
        NULL

      -- extension.drop
      DROP EXTENSION test_extension

      -- language.create
      CREATE TRUSTED LANGUAGE plpgsql
      HANDLER plpgsql_call_handler
      INLINE plpgsql_inline_handler
      VALIDATOR plpgsql_validator

      -- language.alter.owner
      ALTER LANGUAGE plpgsql OWNER TO owner2

      -- language.comment.create
      COMMENT ON LANGUAGE plpgsql IS 'language
        comment'

      -- language.comment.drop
      COMMENT ON LANGUAGE plpgsql IS NULL

      -- language.privilege.grant
      GRANT ALL ON LANGUAGE plpgsql TO
        app_user

      -- language.privilege.revoke
      REVOKE ALL ON LANGUAGE plpgsql FROM
        app_user

      -- language.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON LANGUAGE
        plpgsql FROM app_user

      -- language.drop
      DROP LANGUAGE plpgsql

      -- event_trigger.create
      CREATE EVENT TRIGGER ddl_logger
      ON ddl_command_start
      WHEN TAG IN (
        'CREATE TABLE',
        'ALTER TABLE'
      )
      EXECUTE FUNCTION public.log_ddl()

      -- event_trigger.alter.owner
      ALTER EVENT TRIGGER ddl_logger OWNER TO
        owner2

      -- event_trigger.alter.enabled
      ALTER EVENT TRIGGER ddl_logger ENABLE
        REPLICA

      -- event_trigger.comment.create
      COMMENT ON EVENT TRIGGER ddl_logger IS
        'event trigger comment'

      -- event_trigger.comment.drop
      COMMENT ON EVENT TRIGGER ddl_logger IS
        NULL

      -- event_trigger.drop
      DROP EVENT TRIGGER ddl_logger

      -- collation.create
      CREATE COLLATION public.test
      (
        LOCALE = 'en_US',
        LC_COLLATE = 'en_US',
        LC_CTYPE = 'en_US',
        PROVIDER = icu,
        DETERMINISTIC = false,
        RULES = '& A < a <<< à',
        VERSION = '1.0'
      )

      -- collation.alter.owner
      ALTER COLLATION public.test OWNER TO
        owner2

      -- collation.alter.refresh_version
      ALTER COLLATION public.test REFRESH
        VERSION

      -- collation.comment.create
      COMMENT ON COLLATION public.test IS
        'collation comment'

      -- collation.comment.drop
      COMMENT ON COLLATION public.test IS NULL

      -- collation.drop
      DROP COLLATION public.test"
    `);
  });

  test(formatPrettyPreserve.header, () => {
    const output = `${formatPrettyPreserve.header}\n\n${renderChanges(
      changes,
      formatPrettyPreserve.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, keywordCase: 'preserve', alignColumns: false, indentWidth: 3 }

      -- extension.create
      CREATE EXTENSION test_extension
      WITH SCHEMA public

      -- extension.alter.set_schema
      ALTER EXTENSION test_extension SET SCHEMA extensions

      -- extension.alter.update_version
      ALTER EXTENSION test_extension UPDATE TO '1.1'

      -- extension.comment.create
      COMMENT ON EXTENSION test_extension IS 'extension comment'

      -- extension.comment.drop
      COMMENT ON EXTENSION test_extension IS NULL

      -- extension.drop
      DROP EXTENSION test_extension

      -- language.create
      CREATE TRUSTED LANGUAGE plpgsql
      HANDLER plpgsql_call_handler
      INLINE plpgsql_inline_handler
      VALIDATOR plpgsql_validator

      -- language.alter.owner
      ALTER LANGUAGE plpgsql OWNER TO owner2

      -- language.comment.create
      COMMENT ON LANGUAGE plpgsql IS 'language comment'

      -- language.comment.drop
      COMMENT ON LANGUAGE plpgsql IS NULL

      -- language.privilege.grant
      GRANT ALL ON LANGUAGE plpgsql TO app_user

      -- language.privilege.revoke
      REVOKE ALL ON LANGUAGE plpgsql FROM app_user

      -- language.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON LANGUAGE plpgsql FROM app_user

      -- language.drop
      DROP LANGUAGE plpgsql

      -- event_trigger.create
      CREATE EVENT TRIGGER ddl_logger
      ON ddl_command_start
      WHEN TAG IN (
         'CREATE TABLE',
         'ALTER TABLE'
      )
      EXECUTE FUNCTION public.log_ddl()

      -- event_trigger.alter.owner
      ALTER EVENT TRIGGER ddl_logger OWNER TO owner2

      -- event_trigger.alter.enabled
      ALTER EVENT TRIGGER ddl_logger ENABLE REPLICA

      -- event_trigger.comment.create
      COMMENT ON EVENT TRIGGER ddl_logger IS 'event trigger comment'

      -- event_trigger.comment.drop
      COMMENT ON EVENT TRIGGER ddl_logger IS NULL

      -- event_trigger.drop
      DROP EVENT TRIGGER ddl_logger

      -- collation.create
      CREATE COLLATION public.test
      (
         LOCALE = 'en_US',
         LC_COLLATE = 'en_US',
         LC_CTYPE = 'en_US',
         PROVIDER = icu,
         DETERMINISTIC = false,
         RULES = '& A < a <<< à',
         VERSION = '1.0'
      )

      -- collation.alter.owner
      ALTER COLLATION public.test OWNER TO owner2

      -- collation.alter.refresh_version
      ALTER COLLATION public.test REFRESH VERSION

      -- collation.comment.create
      COMMENT ON COLLATION public.test IS 'collation comment'

      -- collation.comment.drop
      COMMENT ON COLLATION public.test IS NULL

      -- collation.drop
      DROP COLLATION public.test"
    `);
  });
});
