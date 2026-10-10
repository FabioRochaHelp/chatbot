'use strict';

const { defineConfig } = require('prisma/config');
const config = require('./server/config');

module.exports = defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: { path: 'prisma/migrations' },
    datasource: { url: config.databaseUrl }
});
