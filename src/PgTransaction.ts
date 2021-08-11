import { Log } from 'knight-log'
import { Pool, PoolClient, QueryArrayConfig, QueryArrayResult, QueryConfig, QueryResult, QueryResultRow, Submittable } from 'pg'

let log = new Log('knight-pg-transaction/PgTransaction.ts')

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
    let l = log.mt('connect')

    if (! this.client) {
      l.libUser('No client found. Connecting pool...')
      this.client = await this.pool.connect()
    }

    l.libUser('Returning client...')
    return this.client
  }

  release(): void {
    let l = log.mt('release')
    l.libUser('this.beginCounter', this.beginCounter)

    if (this.beginCounter > 0) {
      throw new Error('Transaction is running. Cannot release.')
    }

    if (this.client && this.beginCounter == 0) {
      l.libUser('There is a client and this.beginCounter is 0. Releasing pool...')
      this.client.release()
      this.client = undefined
      this.beginCounter = 0
      this.throwingWrongCommitOrRollbackError = false
    }
    else {
      l.libUser('this.client is undefined or this.beginCounter is greater than 0. Doing nothing...')
    }

    l.libUser('Returning...')
  }

  async begin(): Promise<void> {
    let l = log.mt('begin')

    if (! this.client) {
      l.libUser('No client found. Connecting...')
      await this.connect()
    }

    if (this.beginCounter == 0) {
      l.libUser('this.beginCounter is 0. Beginning new transaction...')
      await this.client!.query('BEGIN')
      this.beginCounter++

      l.libUser('Executing this.afterBeginFunctions...')
      for (let fn of this.afterBeginFunctions) {
        await fn()
      }
    }
    else {
      l.libUser('this.beginCounter is greater than 0. Increasing this.beginCounter...' + this.beginCounter + ' -> ' + (this.beginCounter + 1))
      this.beginCounter++
    }

    l.libUser('Returning...')
  }

  async commit(): Promise<void> {
    let l = log.mt('commit')
    l.libUser('this.beginCounter', this.beginCounter)

    if (this.beginCounter <= 0) {
      l.libUser('this.beginCounter is 0. Cannot commit. Setting this.throwingWrongCommitOrRollbackError to true...')
      this.throwingWrongCommitOrRollbackError = true
      throw new Error('Transaction not running. Cannot commit.')
    }

    if (this.client == undefined) {
      throw new Error('Postgres pool client is not there anymore')
    }

    if (this.beginCounter == 1) {
      l.libUser('this.beginCounter is 1. Committing transaction...')

      await this.client.query('COMMIT')
      this.client.release()
      this.client = undefined
      this.beginCounter = 0
      this.throwingWrongCommitOrRollbackError = false

      l.libUser('Executing this.afterCommitFunctions...')
      for (let fn of this.afterCommitFunctions) {
        await fn()
      }

      this.afterCommitFunctions = []
    }
    else {
      l.libUser('this.beginCounter is greater than 1. Decrementing this.beginCounter... ' + this.beginCounter + ' -> ' + (this.beginCounter - 1))
      this.beginCounter--
    }

    l.libUser('Returning...')
  }

  async rollback(): Promise<void> {
    let l = log.mt('rollback')
    l.libUser('this.beginCounter', this.beginCounter)

    if (this.beginCounter <= 0) {
      l.libUser('this.beginCounter is 0. Cannot rollback. Setting this.throwingWrongCommitOrRollbackError to true...')
      this.throwingWrongCommitOrRollbackError = true
      throw new Error('Transaction not running. Cannot rollback.')
    }

    if (this.client == undefined) {
      throw new Error('Postgres pool client is not there anymore')
    }

    if (this.beginCounter > 0) {
      l.libUser('this.beginCounter is greater than 0. Rolling back...')
      await this.client.query('ROLLBACK')
      this.client.release()
      this.client = undefined
      this.beginCounter = 0
      this.throwingWrongCommitOrRollbackError = false
    }

    l.libUser('Returning...')
  }

  async runInTransaction<T>(code: () => Promise<T>): Promise<T> {
    let l = log.mt('runInTransaction')

    try {
      let beginCounterBefore = this.beginCounter
      l.libUser('beginCounterBefore', beginCounterBefore)

      await this.begin()

      l.libUser('Executing given code...')
      let result = await code()

      // Check if the user did not call commit and do it for her if needed.
      // In fact, commit as often needed until the beginCounter has the same value as before.
      // Because the user might have called begin multiple times without any call to commit at all.
      
      l.libUser('Call commit until the this.beginCounter has the value from before... ' + this.beginCounter + ' -> ' + beginCounterBefore)
      
      while (this.beginCounter > beginCounterBefore) {
        await this.commit()
      }

      l.libUser('Done calling commit. Returning result...')

      return result
    }
    catch (e) {
      l.error('Caught an error', e)
      l.libUser('this.beginCounter', this.beginCounter)

      if (this.beginCounter > 0) {
        if (! this.throwingWrongCommitOrRollbackError) {
          l.libUser('this.beginCounter is greater than 0 and not throwing from wrong commit nor from wrong rollback. Rolling back...')

          try {
            await this.rollback()
          }
          catch (e) {
            l.libUser('Could not roll back. Releasing pool...')
            this.release()
            throw new Error(e)
          }
        }
  
        l.libUser('Releasing pool...')
        this.release()
      }
      
      l.libUser('Rethrowing error...')
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