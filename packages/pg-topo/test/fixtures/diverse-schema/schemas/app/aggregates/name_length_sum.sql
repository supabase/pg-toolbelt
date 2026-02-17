create aggregate app.name_length_sum(text) (
    sfunc = app.name_length_accum,
    stype = bigint,
    initcond = '0'
);
