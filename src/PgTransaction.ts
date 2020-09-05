import { Pool, PoolClient, QueryArrayConfig, QueryArrayResult, QueryConfig, QueryResult, QueryResultRow, Submittable } from 'pg'

export default class PgTransaction {

  pool: Pool
  client?: PoolClient
  beginCounter: number = 0
  throwingWrongCommitOrRollbackError = false
  afterBeginFunctions: (() => any)[] = []
  afterCommitFunctions: (() => any)[] = []

  constructor(pool: Pool) {
    this.pool = pool
  }

  async connect(): Promise<PoolClient> {
    if (! this.client) {
      this.client = await this.pool.connect()
    }

    return this.client
  }

  release(): void {
    if (this.beginCounter > 0) {
      throw new Error('Transaction is running. Cannot release.')
    }

    if (this.client && this.beginCounter == 0) {
      this.client.release()
      this.client = undefined
      this.beginCounter = 0
      this.throwingWrongCommitOrRollbackError = false
    }
  }

  async begin(): Promise<void> {
    if (! this.client) {
      await this.connect()
    }

    if (this.beginCounter == 0) {
      await this.client!.query('BEGIN')
      this.beginCounter++

      for (let fn of this.afterBeginFunctions) {
        await fn()
      }
    }
    else {
      this.beginCounter++
    }
  }

  async commit(): Promise<void> {
    if (this.beginCounter <= 0) {
      this.throwingWrongCommitOrRollbackError = true
      throw new Error('Transaction not running. Cannot commit.')
    }

    if (this.client == undefined) {
      throw new Error('Postgres pool client is not there anymore')
    }

    if (this.beginCounter == 1) {
      await this.client.query('COMMIT')
      this.client.release()
      this.client = undefined
      this.beginCounter = 0
      this.throwingWrongCommitOrRollbackError = false

      for (let fn of this.afterCommitFunctions) {
        await fn()
      }

      this.afterCommitFunctions = []
    }
    else {
      this.beginCounter--
    }
  }

  async rollback(): Promise<void> {
    if (this.beginCounter <= 0) {
      this.throwingWrongCommitOrRollbackError = true
      throw new Error('Transaction not running. Cannot rollback.')
    }

    if (this.client == undefined) {
      throw new Error('Postgres pool client is not there anymore')
    }

    if (this.beginCounter > 0) {
      await this.client.query('ROLLBACK')
      this.client.release()
      this.client = undefined
      this.beginCounter = 0
      this.throwingWrongCommitOrRollbackError = false
    }
  }

  async runInTransaction<T>(code: () => Promise<T>): Promise<T> {
    try {
      let beginCounterBefore = this.beginCounter
      await this.begin()
      let result = await code()

      // Check if the user did not call commit and do it for her if needed.
      // In fact, commit as often needed until the beginCounter has the same value as before.
      // Because the user might have called begin multiple times without any call to commit at all.
      while (this.beginCounter > beginCounterBefore) {
        await this.commit()
      }

      return result
    }
    catch (e) {
      if (this.beginCounter > 0) {
        console.error(e)

        if (! this.throwingWrongCommitOrRollbackError) {
          try {
            await this.rollback()
          }
          catch (e) {
            console.error(e)
            this.release()
            throw new Error(e)
          }
        }
  
        this.release()  
      }
      
      throw e
    }
  }

  afterBegin(fn: () => any): void {
    this.afterBeginFunctions.push(fn)
  }

  afterCommit(fn: () => any): void {
    this.afterCommitFunctions.push(fn)
  }

  query<T extends Submittable>(queryStream: T): T
  query<R extends any[] = any[], I extends any[] = any[]>(
      queryConfig: QueryArrayConfig<I>,
      values?: I,
  ): Promise<QueryArrayResult<R>>
  query<R extends QueryResultRow = any, I extends any[] = any[]>(
      queryConfig: QueryConfig<I>,
  ): Promise<QueryResult<R>>
  query<R extends QueryResultRow = any, I extends any[] = any[]>(
      queryTextOrConfig: string | QueryConfig<I>,
      values?: I,
  ): Promise<QueryResult<R>>
  query<R extends any[] = any[], I extends any[] = any[]>(
      queryConfig: QueryArrayConfig<I>,
      callback: (err: Error, result: QueryArrayResult<R>) => void,
  ): void
  query<R extends QueryResultRow = any, I extends any[] = any[]>(
      queryTextOrConfig: string | QueryConfig<I>,
      callback: (err: Error, result: QueryResult<R>) => void,
  ): void
  query<R extends QueryResultRow = any, I extends any[] = any[]>(
      queryText: string,
      values: I,
      callback: (err: Error, result: QueryResult<R>) => void,
  ): void

  async query(arg1: any, arg2?: any, arg3?: any): Promise<any> {
    if (this.beginCounter == 0) {
      return this.pool.query(arg1, arg2, arg3)
    }

    return this.client!.query(arg1, arg2, arg3)
  }
}