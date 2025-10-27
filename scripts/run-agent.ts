#!/usr/bin/env ts-node
import { runAgent } from '../lib/agent';
import { logger } from '../lib/logger';

async function main() {
  try {
    const result = await runAgent();
    logger.info('Agent execution summary', { ...result });
    if (result.errors.length > 0) {
      for (const error of result.errors) {
        logger.error(error);
      }
      process.exitCode = 1;
    }
  } catch (error) {
    logger.error('Fatal agent error', { error });
    process.exitCode = 1;
  }
}

main();
