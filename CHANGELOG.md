# Changelog

## 1.0.0 (2025-12-19)


### Features

* add aggregates diffing support ([#62](https://github.com/supabase/pg-delta/issues/62)) ([8a86bf5](https://github.com/supabase/pg-delta/commit/8a86bf58c311855af9b6377cb262082e3674c41e))
* add event triggers diffing support ([#66](https://github.com/supabase/pg-delta/issues/66)) ([9da11db](https://github.com/supabase/pg-delta/commit/9da11db96df248b1be425f47c2ea461b5cbb20e2))
* add publications diffing support ([#64](https://github.com/supabase/pg-delta/issues/64)) ([1546adc](https://github.com/supabase/pg-delta/commit/1546adc9640606f0d837d9bbf2fcde4c544a645d))
* add rules diffing support ([#63](https://github.com/supabase/pg-delta/issues/63)) ([d484637](https://github.com/supabase/pg-delta/commit/d4846378433b9e92da1ae5c3abfb1dedeff08db4))
* add subscriptions diffing support ([#65](https://github.com/supabase/pg-delta/issues/65)) ([75afdec](https://github.com/supabase/pg-delta/commit/75afdec5e77ac583a6453f904707584efbc59009))
* add support for comments ([#48](https://github.com/supabase/pg-delta/issues/48)) ([90de051](https://github.com/supabase/pg-delta/commit/90de0519d343d84fd428d2b51d69bea5b224f726))
* CLI ([#77](https://github.com/supabase/pg-delta/issues/77)) ([cc7e031](https://github.com/supabase/pg-delta/commit/cc7e031f125f64d55e4ffbd54995e56878f25f19))
* foreign data wrappers diffing support ([#71](https://github.com/supabase/pg-delta/issues/71)) ([eddac59](https://github.com/supabase/pg-delta/commit/eddac598befd2e42463e5ed39f33d6edc0f38c62))
* implement a programmatic filtering hook ([#57](https://github.com/supabase/pg-delta/issues/57)) ([27e9f68](https://github.com/supabase/pg-delta/commit/27e9f68bd93222735978ea5bb07167eb6d325478))
* implement aggregates diffing ([71fbeed](https://github.com/supabase/pg-delta/commit/71fbeed05d00427a1e0ca8322e41d26c5b887a8d))
* integration DSL ([#83](https://github.com/supabase/pg-delta/issues/83)) ([63d9c94](https://github.com/supabase/pg-delta/commit/63d9c944c24a2216a615ae4335e41bdaec60de21))
* privileges ([#50](https://github.com/supabase/pg-delta/issues/50)) ([c550111](https://github.com/supabase/pg-delta/commit/c5501112d6d5d1772167bbea4f64040920539ddc))
* sensitive infos masking and environment dependent diffing ([#72](https://github.com/supabase/pg-delta/issues/72)) ([b7ab4ca](https://github.com/supabase/pg-delta/commit/b7ab4ca14e6422ae194dff7ea4ef9b511afb7c0e))
* support changing role after connect ([#81](https://github.com/supabase/pg-delta/issues/81)) ([34f58ac](https://github.com/supabase/pg-delta/commit/34f58ac7a0c59d0a8b950c68fe893bbbf6b56d38))
* support SSL connections ([#82](https://github.com/supabase/pg-delta/issues/82)) ([0eb4c1c](https://github.com/supabase/pg-delta/commit/0eb4c1c9cef87f807b0bab54e098c6b59eb186f6))


### Bug Fixes

* all tests for pg15 ([#35](https://github.com/supabase/pg-delta/issues/35)) ([0c9440d](https://github.com/supabase/pg-delta/commit/0c9440d3520aba75469af13c8ba9f4b320d3827d))
* **collation:** make it postgres version dependent ([501188d](https://github.com/supabase/pg-delta/commit/501188d06bdf487c8ca927520f4a167994e806b5))
* dependency resolution roles and fk ([#47](https://github.com/supabase/pg-delta/issues/47)) ([b2b3ad1](https://github.com/supabase/pg-delta/commit/b2b3ad146760511ee4b06cc6f1b32babcee1fb7a))
* encodeURI password ([975784d](https://github.com/supabase/pg-delta/commit/975784d674521b5c4148f3f07bd3158632baf181))
* escape underscores in sql string literal ([098b5b5](https://github.com/supabase/pg-delta/commit/098b5b5b9fbd07779aa32563b4f719e8f35ae142))
* escape underscores in sql string literal ([d436215](https://github.com/supabase/pg-delta/commit/d4362157822f3b39b16583a858057543b738fa41))
* include partitioned index in inspection query ([#9](https://github.com/supabase/pg-delta/issues/9)) ([d296cb9](https://github.com/supabase/pg-delta/commit/d296cb9d2f5c3a8ebb7e941fee6c66cc99f7b9e6))
* index extraction partitions tables ([#53](https://github.com/supabase/pg-delta/issues/53)) ([4c35de9](https://github.com/supabase/pg-delta/commit/4c35de9057e17313bdb18e724e23d4372ae74ae3))
* materialized-views.test.ts for postgres 15 ([47b3d77](https://github.com/supabase/pg-delta/commit/47b3d77ca6fbde2d6f5d4c7a295c2a87ddb9c7ee))
* real-world project various fixes ([#54](https://github.com/supabase/pg-delta/issues/54)) ([f116998](https://github.com/supabase/pg-delta/commit/f11699846958fcb7a39abb4f8e3aba351bca158d))
* refactor sorting algorithm ([#67](https://github.com/supabase/pg-delta/issues/67)) ([edf19ea](https://github.com/supabase/pg-delta/commit/edf19ea9bf13e8fa42ad7e57f54feaf9a7c2d82a))
* test diffs between postgres version ([4de44dc](https://github.com/supabase/pg-delta/commit/4de44dce825dcce009172de6c12548df014a10f1))
* various bugs and improvements from real-world integration tests ([#58](https://github.com/supabase/pg-delta/issues/58)) ([551bdf4](https://github.com/supabase/pg-delta/commit/551bdf4d86ecfff957fdc219b28a545af47a9e39))
* views.test.ts for postgres 15 ([c2e4b9a](https://github.com/supabase/pg-delta/commit/c2e4b9a9e6b2c0891a5a8a67876b362df8da2b72))
