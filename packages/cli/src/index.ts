#!/usr/bin/env node
import { main } from './commands.js';

process.exitCode = await main(process.argv.slice(2));
