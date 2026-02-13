create foreign data wrapper app_fdw;

create server app_foreign_server
    foreign data wrapper app_fdw;
