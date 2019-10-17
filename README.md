# rethinkdb-ts-migrate
A migration tool for RethinkDB

## Overview

`rethinkdb-ts-migrate` is a utility allowing you to version
changes to a [RethinkDB](http://rethinkdb.com) database. Forward
or backward migrate structural or data changes. Share
and control these changes with other developers.

This code is a fork of Johan Obrink's
[rethink-migrate](https://github.com/JohanObrink/rethink-migrate).
`rethinkdb-ts-migrate` is more actively maintained.


## Install

```bash
$ npm install -g rethinkdb-ts-migrate
```

## Setup

Install a RethinkDB driver:

```bash
npm install --save rethinkdb
```

or

```bash
npm install --save rethinkdbdash
```

Create a ```database.json``` file in the root of your solution with the format:

```json
{
  "host": "localhost",
  "port": 28015,
  "db": "migrations",
  "discovery": true,
  "timeout": 60
}
```

Other, optional, parameters are `authKey` and `ssl`.

You can also use environment variables or arguments to override.

## Create migration

```bash
$ rethinkdb-ts-migrate create [migration name]
```

For example:

```bash
rethinkdb-ts-migrate create add-tables
```

## Edit migration

Open the file `./migrations/[timestamp]-[migration name].ts`

Add the changes to be made. For example:

```javascript
exports.up = function (r, connection) {
  return r.tableCreate('foo').run(connection);
};

exports.down = function (r, connection) {
  return r.tableDrop('foo').run(connection);
};
```

## Run migrations

`rethinkdb-ts-migrate up --one` will run one up migration.

`rethinkdb-ts-migrate up --all` will run all outstanding up migrations.

`rethinkdb-ts-migrate down --one` will run one down migration.

`rethinkdb-ts-migrate down --all` will run all outstanding down migrations.

If either `--all` or `--one` isn't specified, `--all` is the default.

### Options

`rethinkdb-ts-migrate up --root ./build` will run all outstanding up migrations
  found in `./build/migrations` with `database.json` in `./build`.
`-r` can be used as an alias.

`rethinkdb-ts-migrate up --logLevel debug` will set logLevel to debug.
  Possible values are: debug | info | warning | error | none.
`-l` can be used as an alias.

## Run tests

Run `docker-compose up`
If necessary, change the IP address in `test/database.json`
Run `gulp jshint test`

To run tests continually, add `watch` to the gulp command

# License

The MIT License (MIT)

Copyright (c) 2017 [Parabol, Inc.](https://parabol.co)
Copyright (c) 2015 Johan Öbrink

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
