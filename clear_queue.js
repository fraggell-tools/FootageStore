
const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
const queue = new Queue('clip-processing', { connection: redis });
queue.obliterate({ force: true }).then(() => {
  console.log('Queue cleared');
  redis.quit();
}).catch(e => { console.error(e.message); redis.quit(); });
