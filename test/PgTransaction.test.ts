import * as chai from 'chai'
import * as chaiAsPromised from 'chai-as-promised'
import 'mocha'
import { Pool, PoolConfig } from 'pg'
import PgTransaction from '../src/PgTransaction'

chai.use(chaiAsPromised)
let expect = chai.expect

let poolHolder: { pool: Pool } = {} as any

describe('PgTransaction', function() {
  beforeEach(async function() {
    poolHolder.pool = new Pool(<PoolConfig> {
      host: 'db',
      database: 'transaction_test',
      user: 'transaction_test',
      password: 'transaction_test'
    })

    await poolHolder.pool.query('CREATE TABLE IF NOT EXISTS a ( b INTEGER )')
  })

  afterEach(async function() {
    await poolHolder.pool.query('DROP TABLE IF EXISTS a CASCADE')
    await poolHolder.pool.end(() => {})
  })

  describe('connect', function() {
    it('should connect', async function() {
      let tx = new PgTransaction(poolHolder.pool)
      
      await tx.connect()

      expect(tx.client).to.be.not.undefined
      expect(poolHolder.pool.idleCount).to.equal(0)
    })

    it('should not connect a second time', async function() {
      let tx = new PgTransaction(poolHolder.pool)
      
      await tx.connect()
      await tx.connect()

      expect(tx.client).to.be.not.undefined
      expect(poolHolder.pool.idleCount).to.equal(0)
    })
  })

  describe('release', function() {
    it('should release', async function() {
      let tx = new PgTransaction(poolHolder.pool)
      
      await tx.connect()
      expect(tx.client).to.be.not.undefined
      expect(poolHolder.pool.idleCount).to.equal(0)

      tx.release()
      expect(tx.client).to.be.undefined
      expect(poolHolder.pool.idleCount).to.equal(1)
    })

    it('should not release when inside a transaction', async function() {
      let tx = new PgTransaction(poolHolder.pool)
      
      await tx.connect()
      await tx.begin()

      expect(function() { tx.release() }).to.throw('Transaction is running. Cannot release.')
    })
  })

  describe('begin', function() {
    it('should beginn a transaction and connect automatically', async function() {
      let tx = new PgTransaction(poolHolder.pool)

      await tx.begin()
      expect(tx.client).to.be.not.undefined
      expect(tx.beginCounter).to.equal(1)
    })

    it('should increase the begin counter when beginning another transaction where one was alread started', async function() {
      let tx = new PgTransaction(poolHolder.pool)

      await tx.begin()
      await tx.begin()
      expect(tx.client).to.be.not.undefined
      expect(tx.beginCounter).to.equal(2)

      await tx.begin()
      expect(tx.client).to.be.not.undefined
      expect(tx.beginCounter).to.equal(3)
    })

    it('should call all of the after begin handler functions', async function() {
      let tx = new PgTransaction(poolHolder.pool)

      let afterBeginHolder = {
        afterBegin1: false,
        afterBegin2: false
      }

      tx.afterBegin(() => {
        afterBeginHolder.afterBegin1 = true
      })

      tx.afterBegin(() => {
        afterBeginHolder.afterBegin2 = true
      })

      await tx.begin()

      expect(afterBeginHolder.afterBegin1).to.be.true
      expect(afterBeginHolder.afterBegin2).to.be.true

      afterBeginHolder.afterBegin1 = false
      afterBeginHolder.afterBegin2 = false

      tx.commit()

      expect(afterBeginHolder.afterBegin1).to.be.false
      expect(afterBeginHolder.afterBegin2).to.be.false
    })
  })

  describe('commit', function() {
    it('should commit a transaction', async function() {
      let tx = new PgTransaction(poolHolder.pool)

      await tx.begin()
      await tx.query('INSERT INTO a VALUES (1)')
      await tx.commit()

      expect(tx.client).to.be.undefined
      expect(tx.beginCounter).to.equal(0)

      let result = await poolHolder.pool.query('SELECT * FROM a')
      expect(result.rows.length).to.equal(1)
      expect(result.rows[0].b).to.equal(1)
    })

    it('should not commit a transaction if there was more than one begin', async function() {
      let tx = new PgTransaction(poolHolder.pool)

      await tx.begin()
      await tx.begin()
      await tx.query('INSERT INTO a VALUES (1)')
      await tx.commit()
      
      expect(tx.client).to.be.not.undefined
      expect(tx.beginCounter).to.equal(1)

      let result = await poolHolder.pool.query('SELECT * FROM a')
      expect(result.rows.length).to.equal(0)

      // clean up
      await tx.commit()
    })

    it('should commit a transaction if there was more than one begin', async function() {
      let tx = new PgTransaction(poolHolder.pool)

      await tx.begin()
      await tx.begin()
      await tx.query('INSERT INTO a VALUES (1)')
      await tx.commit()
      await tx.commit()

      expect(tx.client).to.be.undefined
      expect(tx.beginCounter).to.equal(0)

      let result = await poolHolder.pool.query('SELECT * FROM a')
      expect(result.rows.length).to.equal(1)
      expect(result.rows[0].b).to.equal(1)
    })

    it('should throw an error if the transaction was not started', async function() {
      let tx = new PgTransaction(poolHolder.pool)
      expect(tx.commit()).to.be.rejectedWith('Transaction not running. Cannot commit.')
    })

    it('should throw an error if there was a commit too much', async function() {
      let tx = new PgTransaction(poolHolder.pool)

      await tx.begin()
      await tx.commit()

      expect(tx.commit()).to.be.rejectedWith('Transaction not running. Cannot commit.')
    })

    it('should call all of the after commit handler functions', async function() {
      let tx = new PgTransaction(poolHolder.pool)

      let afterCommitHolder = {
        afterCommit1: false,
        afterCommit2: false
      }

      await tx.begin()

      tx.afterCommit(() => {
        afterCommitHolder.afterCommit1 = true
      })

      tx.afterCommit(() => {
        afterCommitHolder.afterCommit2 = true
      })

      await tx.commit()

      expect(afterCommitHolder.afterCommit1).to.be.true
      expect(afterCommitHolder.afterCommit2).to.be.true
    })

    it('should call all of the after commit handler functions and throw the first error', async function() {
      let tx = new PgTransaction(poolHolder.pool)

      await tx.begin()

      await tx.query('INSERT INTO a VALUES (1)')

      tx.afterCommit(() => {
        throw new Error('afterCommit1')
      })

      tx.afterCommit(() => {
        throw new Error('afterCommit2')
      })

      expect(tx.commit()).to.be.rejectedWith('afterCommit1')

      let result = await poolHolder.pool.query('SELECT * FROM a')
      expect(result.rows.length).to.equal(1)
      expect(result.rows[0].b).to.equal(1)
    })

    it('should call the after commit handler functions only one time', async function() {
      let tx = new PgTransaction(poolHolder.pool)

      let afterCommitHolder = {
        afterCommit1: false,
        afterCommit2: false
      }

      await tx.begin()

      tx.afterCommit(() => {
        afterCommitHolder.afterCommit1 = true
      })

      tx.afterCommit(() => {
        afterCommitHolder.afterCommit2 = true
      })

      await tx.commit()

      expect(afterCommitHolder.afterCommit1).to.be.true
      expect(afterCommitHolder.afterCommit2).to.be.true

      afterCommitHolder.afterCommit1 = false
      afterCommitHolder.afterCommit2 = false

      await tx.begin()
      await tx.commit()

      expect(afterCommitHolder.afterCommit1).to.be.false
      expect(afterCommitHolder.afterCommit2).to.be.false
    })
  })

  describe('rollback', function() {
    it('should rollback', async function() {
      let tx = new PgTransaction(poolHolder.pool)

      await tx.begin()
      await tx.query('INSERT INTO a VALUES (1)')
      await tx.rollback()

      expect(tx.client).to.be.undefined
      expect(tx.beginCounter).to.equal(0)

      let result = await poolHolder.pool.query('SELECT * FROM a')
      expect(result.rows.length).to.equal(0)
    })

    it('should rollback if there was more than one begin', async function() {
      let tx = new PgTransaction(poolHolder.pool)

      await tx.begin()
      await tx.begin()
      await tx.query('INSERT INTO a VALUES (1)')
      await tx.rollback()

      expect(tx.client).to.be.undefined
      expect(tx.beginCounter).to.equal(0)

      let result = await poolHolder.pool.query('SELECT * FROM a')
      expect(result.rows.length).to.equal(0)
    })

    it('should throw an error if the transaction was not started', async function() {
      let tx = new PgTransaction(poolHolder.pool)
      expect(tx.rollback()).to.be.rejectedWith('Transaction not running. Cannot rollback.')
    })

    it('should throw an error if there was a rollback too much', async function() {
      let tx = new PgTransaction(poolHolder.pool)

      await tx.begin()
      await tx.rollback()

      expect(tx.rollback()).to.be.rejectedWith('Transaction not running. Cannot rollback.')
    })
  })

  describe('runInTransaction', function() {
    it('should wrap the code in a transaction', async function() {
      let tx = new PgTransaction(poolHolder.pool)
      
      await tx.runInTransaction(async () => {
        expect(tx.beginCounter).to.equal(1)
      })

      expect(tx.beginCounter).to.equal(0)
    })

    it('should commit as many times as it begun', async function() {
      let tx = new PgTransaction(poolHolder.pool)

      await tx.begin()
      await tx.begin()

      await tx.runInTransaction(async () => {
        await tx.begin()
        await tx.begin()
      })

      expect(tx.beginCounter).to.equal(2)
    })

    it('should rollback if there was an error', async function() {
      let tx = new PgTransaction(poolHolder.pool)

      try {
        await tx.runInTransaction(async () => {
          await tx.query('INSERT INTO a VALUES (1)')
          throw new Error()
        })
      }
      catch (e) {}

      let result = await poolHolder.pool.query('SELECT * FROM a')
      expect(result.rows.length).to.equal(0)
    })

    it('should release the client if there was an error', async function() {
      let tx = new PgTransaction(poolHolder.pool)

      try {
        await tx.runInTransaction(async () => {
          await tx.query('INSERT INTO a VALUES (1)')
          throw new Error()
        })
      }
      catch (e) {}

      expect(tx.client).to.be.undefined
      expect(tx.beginCounter).to.equal(0)
    })

    it('should not rollback if there was a commit without a transaction', async function() {
      let tx = new PgTransaction(poolHolder.pool)

      await tx.runInTransaction(async () => {
        await tx.commit()
        expect(tx.commit()).to.be.rejectedWith('Transaction not running. Cannot commit.')
      })
    })

    it('should not rollback if there was a rollback without a transaction', async function() {
      let tx = new PgTransaction(poolHolder.pool)

      await tx.runInTransaction(async () => {
        await tx.commit()
        expect(tx.rollback()).to.be.rejectedWith('Transaction not running. Cannot rollback.')
      })
    })
  })

  describe('query', function() {
    it('should query inside a transaction', async function() {
      let tx = new PgTransaction(poolHolder.pool)

      await tx.begin()
      await tx.query('INSERT INTO a VALUES (1)')
      await tx.commit()

      let result = await poolHolder.pool.query('SELECT * FROM a')
      expect(result.rows.length).to.equal(1)
      expect(result.rows[0].b).to.equal(1)
    })

    it('should query without a started transaction', async function() {
      let tx = new PgTransaction(poolHolder.pool)

      await tx.query('INSERT INTO a VALUES (1)')

      let result = await poolHolder.pool.query('SELECT * FROM a')
      expect(result.rows.length).to.equal(1)
      expect(result.rows[0].b).to.equal(1)
    })
  })
})
