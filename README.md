# Discord DB

Zero dependency, client based pseudo-RDBMS solution backed by Discord.

## Installation and Usage

- NodeJS (required by CLI)
- JS environment (can be a browser, Node session etc.)

See documentation section for usage

## Why this

This project was created to in light of the expensive costs associated with running even smaller scale DBMS. Unmanaged solutions (self-provisioned EC2 instances running a Postgres client, for example) are cheaper but will not
offer reliability (mostly backup, which is prohibitively expensive in most cases) or security out the box. Managed solutions (BaaS like Firebase) offers a free tier with a progressive pricing system that can easily become
a cash sinkhole if users are not careful with their usage (and also a restrictive ecosystem + a bloated client). Discord DB is created to address pricing issues whilst also maintaining enterprise level reliability guarantee (backed by Discord).

### Advantages:

- Zero dependency, no backend (forget those pesky SSL certs), zero cost with unlimited storage/bandwith[1\]
- Enterprise level reliability and security guaranteed by Discord
- Easy to set up and simple API. Offers high degrees of flexibility to suit your needs

### Disadvantages:

- Bounded by Discord's limitations.
- Hard to scale
- Race conditions[2\]

### Who can use this:

- Readonly sites (blogs, personal portfolios etc.)
- Gatekeeped/Paywalled sites
- Hackathon MVPs
- Small scale or personal projects

[1\] Discord's rate limiting system can limit how frequently an API can be triggered. However, individual API's payload size is unrestricted (up to a hard limit of 25MB imposed by Discord).

[2\] Race conditions happens when a DB write can cause indexes to become stale if there is a concurrent write in progress. DB reads do not suffer from race conditions.

## Documentation

### Configuring security

As this library is designed to be a frontend client, this means extra care has to be taken in order not to leak sensitive information, such as your discord bot token. Below is a recommended method of protecting access to your database.

Similar to how other FE clients (such as Firebase) protect DB access, there should be multiple discord bots with varying access levels. Users should only have access to clients configuered with bots that can access information which they are authorized to access. In general, each user should have their own corresponding bot with access to only tables containing their data (or data they have access to). This means the database should be setup such that each user gets their own table.

However, the database can also be protected with limited write access, as opposed to silo'ing by user. For example, a public blogging site is going to want to have a bot with "read all" permission, but no write permissions, for public users. The "write" permission should only be reserved for people that have authorization to blog.

The general rule of thumb is to assume that the user has access to all information contained within the code, which includes statically configuered bot tokens. Therefore, one must secure the database in such a way that even if a malicious actor obtained a token, they can do no harm other than intended/permissiable action.

### API documentation

CLI commands are case insensitive, its arguments are case sensitive.\

Any writes to the DB (create, update, delete) on the same table have the potential to cause race conditions and inconsistent indexing. It is recommended to limit concurrent writes as much as possible.

Disord enforces a hard limit of 25MB per message, which means individual records cannot exceed 25MB in size when serialised into a JSON string. Although indexes support chunking, records currently do not.

Avoid sending concurrent async requests when possible (i.e using `Promise.all` to wait for a batch of requests). Although the client is written to respect Discord's rate limit headers, it cannot cancel in-flight requests which means a trigger-happy function can potentially dispatch too many requests before the first request can respond with relevant rate limit information. Tripping discord's rate limit will not cause immediate harm (and the client is written to respect rate limited responses). However, as per Discord's official API docs, frequent violations can result in a ban.

#### Creating a table (CLI only)

Creates a new table by creating a new channel

Syntax: CREATE TABLE {tableName}

Example: CREATE TABLE myTable

#### Createing a table schema (CLI only)

Creates a new schema for a table. Schema resides in a channel named {tableName}_idx. Command will fail if schema already exists. Note that typically this command should be ran right after creating a new table. Note that `dbId` is not available as a column name as it is a reserved column used to represent Discord's messageId for a particular record.

Syntax: CREATE SCHEMA {tableName} ({columnName} {columnType})...

Example: CREATE SCHEMA myTable myColumn num myColumn2 str

#### Getting a table schema (CLI only)

Gets a table's schema in JSON form.

Syntax: GET SCHEMA {tableName}

Example: GET SCHEMA myTable

#### Creating an index (CLI only)

Creates an index for a particular column in a table. Created indexes are named {columnName}\_idx_{sequenece_num}, and stored in {tableName}_idx channel. Note that this command will re-create indexes based on the current records in a table, and will fail if there are existing indexes. Therefore, it is recommended to use this only when a new table is created or when attempting to fix corrupted indexes (deleting old indexes and creating new indexes based on current records in a table).

This command requires a valid schema defined.

Syntax: CREATE INDEX {tableName} {columnName}

Example: CREATE INDEX myTable myColumn

#### Inserting records

Inserts a new record into a table. If there are no indexes present or if all existing indexes are full (reached maximum file size), new indexes will be automatically created.

CLI syntax: INSERT {tableName} ({columnName} {value})...

CLI example: INSERT myTable myColumn 100

Client syntax: `client.insert({ columnName: value, ... })`

Client example: `await client.insert({ myColumn: 100 })`

#### Selecting records

Selects record(s) from a table, with an optional condition(s), limit and ability to sort retrieved records. Note that due to Discord's rate limiting, it is not performant to perform conditional query when it returns a large amount of records, as each record is retrieved separately. Instead, only use conditional query when the expected number of results are small (or if the table size is too big). Otherwise, it is more performant to perform in-memory filtering outside of the client.

Available operators:

- '=' `equals()`
- '>' `greaterThan()` num only
- '<' `lessThan()` num only
- 'in' `partOf()`

Available ordering:

- 'asc' `ascending()`
- 'dsc' `descending()`

Returns a list of records as JSON objects with `dbId` as a reserved column (Discord's messageId).

CLI syntax: SELECT {tableName} \<Optional>WHERE ({columnName} {operator} {value})... \<Optional>LIMIT {value} \<Optional>ORDERBY {columnName} {ordering}

CLI example (full): SELECT myTable WHERE myColumn < 5 LIMIT 100 ORDERBY myColumn ASC

Client syntax: `client.select(tableName).where?(...conditionals).limitBy?(limitValue).orderBy?(order)`

Client example (full): `await client.select(myTable).where(lessThan(myColumn, 5)).limitBy(100).orderBy(ascending(myColumn))`

#### Updating records

Updates a record from a table, by messageId (dbId). The old record is overwritten which means all columns must be specified. To update a specific column(s), specify original values to other columns.

CLI syntax: UPDATE {tableName} {messageId} ({columnName} {value})...

CLI example: UPDATE myTable 123456789 myColumn 2

Client syntax: `client.update(tableName, id, { columnName: value ... })`

Client example: `await client.update(myTable, 123456789, { myColumn: 2 })`

#### Deleting records

Deletes a record from a table, by messageId (dbId).

CLI syntax: DELETE {tableName} {messageId}

CLI example: DELETE myTable 123456789

Client syntax: `client.delete(tableName, id)`

Client example: `await client.delete(myTable, 123456789)`

## Contribution

I do not intend on actively maintaining this project aside from critical bug fixes or the occasional feature push, as I am personally using this and will only push a new feature if it fufills a particular personal need.

However, feel free to contribute by forking and raising a PR. I am open to any change, whether that is a feature, bugfix, optimisation or even code refactoring. The only requirements I have is:

- Do not break existing functionality
- Keep it 100% client sided (or at least can be 100% client sided)
- No NPM packages (feel free to include raw source files) and ideally no other 3rd party dependency other than Discord.
