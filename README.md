# Knight PostgreSQL Transaction by Coderitter

A transaction lib for PostgreSQL.

## Related packages

There is an SQL package [knight-sql](https://github.com/c0deritter/knight-sql) which helps with building SQL strings. It can be combined with [knight-criteria](https://github.com/c0deritter/knight-criteria) and [knight-sql-criteria-filler](https://github.com/c0deritter/knight-sql-criteria-filler). If you are looking for a more sophisticated version for database access you can also use [knight-orm](https://github.com/c0deritter/knight-orm).

Another helpful PostgreSQL tool is [knight-pg-migration](https://github.com/c0deritter/knight-pg-migration).

## Install

`npm install knight-pg-transaction`

## Quickstart

```typescript
import { PgTransaction } from 'knight-pg-transaction'
import { Pool } from 'pg'

let pool = new Pool({ host: ... })
let tx = new PgTransaction(pool)

tx.runInTransaction(async () => {
    await tx.query('SELECT * FROM user')
})
```

## Overview

### runInTransaction()

The method `runInTransaction()` is the peferred way of handling transactions in your code. Though you can also call the needed methods directly.

It will begin the transaction, will commit it if there was no error thrown or roll it back otherwise.


```typescript
tx.runInTransaction(async () => {
    await tx.query('SELECT * FROM user')

    if (result.rowCount == 0) {
        // you can still call rollback() at any time
        await tx.rollback()
        return 'No users found'
    }
})
```

### begin(), commit(), rollback()

`begin()` fetches a connection from the connection pool and starts a transaction for this connection. `commit()` commits the transaction and also releases the connection back to the pool. `rollback()` rolls back the transaction and also releases the connection back to the pool.

```typescript
tx.begin()
tx.commit()

/* or */

tx.begin()
tx.rollback()
```

You can call `begin()` multiple times which needs to be matched with equally many calls to `commit()` or one to `rollback()`. This is useful for nested transactions. A nested transaction is just in the code but not in the database. In the database there is no support for nested transactions, thus a nested transaction in the code still needs to be an ordinary transaction in the database.

```typescript
tx.begin() // starts a transaction
tx.begin() // does not start another transaction

tx.commit() // does not commit the transaction
tx.commit() // commits the transaction

/* or */

tx.begin() // starts a transaction
tx.begin() // does not start another transaction

tx.rollback() // rolls back the transaction
```

If you call `commit()` or `rollback()` without having called begin, both methods will throw an error.

### query()

Resembles the standard PostgreSQL pool query method. If the transaction has gained a connection from the pool it will use it. Otherwise it will call query on the pool directly. That way you can either use the transaction as it was the pool or you can also use it with a explicit connection gained from the pool but without using any transactions.

```typescript
let result = await tx.query('SELECT * FROM table WHERE column = ?', [1])
```

### connect()

Fetches a connection from the pool. This method will automatically be called when calling `begin()`.

```typescript
await tx.connect()

// you can safely call connect multiple times in a row without connecting multiple times but only one time
await tx.connect()
```

### release

Releases the connection to the pool. This method will automatically be called when calling `commit()` or `rollback()`. When there is a running transaction this method will not release the connection but throw an error.

```typescript
await tx.release()
```